param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [string]$ComposeFile = 'docker-compose.production.yml',
    [string]$DatabaseUser = 'fanpage',
    [string]$EnvironmentFile = '.env.production',
    [string]$TargetDatabase = ('fanpage_sales_agent_restore_' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,8))
)
$ErrorActionPreference = 'Stop'
if ($TargetDatabase -notmatch '^fanpage_sales_agent_restore_[a-z0-9_]+$') { throw 'Restore requires a separate disposable database' }
if ($DatabaseUser -notmatch '^[a-z][a-z0-9_]+$') { throw 'Invalid database user' }
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$metadata = Get-Content -LiteralPath ($archivePath + '.json') -Raw | ConvertFrom-Json
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $metadata.sha256) { throw 'Backup checksum mismatch' }
$composeArgs = @('compose', '--env-file', $EnvironmentFile, '-f', $ComposeFile)
$container = (& docker @composeArgs ps -q postgres).Trim()
if ($LASTEXITCODE -ne 0 -or $container -notmatch '^[a-f0-9]{12,64}$') { throw 'Postgres container unavailable' }
$remote = '/tmp/restore-' + [Guid]::NewGuid().ToString('N') + '.dump'
try {
    & docker cp $archivePath "${container}:$remote"
    if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
    & docker exec $container createdb --username=$DatabaseUser $TargetDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Disposable database creation failed; existing targets are never overwritten' }
    & docker exec $container pg_restore --username=$DatabaseUser --dbname=$TargetDatabase --exit-on-error --no-owner --no-privileges $remote
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
    $count = (& docker exec $container psql --username=$DatabaseUser --dbname=$TargetDatabase --tuples-only --no-align --command='SELECT count(*) FROM schema_migrations').Trim()
    if ($LASTEXITCODE -ne 0 -or [int]$count -ne [int]$metadata.migrationCount) { throw 'Restored migration count mismatch' }
    & docker exec $container psql --username=$DatabaseUser --dbname=$TargetDatabase --command="SELECT 'messages' AS table_name, count(*) FROM messages UNION ALL SELECT 'orders', count(*) FROM orders UNION ALL SELECT 'webhook_events', count(*) FROM webhook_events;"
    if ($LASTEXITCODE -ne 0) { throw 'Restored table verification failed' }
    Write-Output ('Restore verified: ' + $TargetDatabase)
    Write-Output 'Disposable database retained for inspection; no production data was changed.'
} finally {
    & docker exec $container rm -f -- $remote
}
