param(
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [string]$ComposeFile = 'docker-compose.production.yml',
    [string]$Database = 'fanpage_sales_agent',
    [string]$DatabaseUser = 'fanpage',
    [string]$EnvironmentFile = '.env.production'
)
$ErrorActionPreference = 'Stop'
if ($Database -notmatch '^[a-z][a-z0-9_]+$' -or $DatabaseUser -notmatch '^[a-z][a-z0-9_]+$') { throw 'Invalid database identity' }
$destination = [IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$name = 'fanpage-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N')
$archive = Join-Path $destination ($name + '.dump')
if (Test-Path -LiteralPath $archive) { throw 'Backup already exists' }
$composeArgs = @('compose', '--env-file', $EnvironmentFile, '-f', $ComposeFile)
$container = (& docker @composeArgs ps -q postgres).Trim()
if ($LASTEXITCODE -ne 0 -or $container -notmatch '^[a-f0-9]{12,64}$') { throw 'Postgres container unavailable' }
$remote = '/tmp/' + $name + '.dump'
try {
    & docker exec $container pg_dump --username=$DatabaseUser --dbname=$Database --format=custom --file=$remote
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
    & docker cp "${container}:$remote" $archive
    if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
    $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $revision = (& git rev-parse HEAD).Trim()
    $migrationCount = (& docker exec $container psql --username=$DatabaseUser --dbname=$Database --tuples-only --no-align --command='SELECT count(*) FROM schema_migrations').Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Migration metadata query failed' }
    @{ archive = [IO.Path]::GetFileName($archive); sha256 = $checksum; gitSha = $revision; database = $Database; migrationCount = [int]$migrationCount; createdAt = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath ($archive + '.json') -Encoding UTF8
    Write-Output ('Backup: ' + $archive)
    Write-Output ('SHA256: ' + $checksum)
} finally {
    & docker exec $container rm -f -- $remote
}
