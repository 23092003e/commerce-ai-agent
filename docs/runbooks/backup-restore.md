# Backup and disposable restore

Never commit database dumps. The scripts accept an explicit destination and do not print database connection strings. Keep an encrypted backup outside the host machine for an actual deployment.

## Back up

From the repository root, after confirming the destination:

```powershell
./scripts/backup-postgres.ps1 -BackupDirectory 'D:\fanpage-backups'
```

The script writes a custom-format dump and adjacent JSON containing SHA-256, UTC creation time, source database, source Git SHA and migration count. It refuses an existing output path. A successful command proves a backup exists, not that it can be restored.

## Restore drill

```powershell
./scripts/restore-postgres.ps1 -Archive 'D:\fanpage-backups\<backup>.dump'
```

The restore checks the checksum, creates a uniquely named `fanpage_sales_agent_restore_*` database, restores with error checking, compares migration counts, and reads core table counts. It refuses any target outside that naming pattern and never overwrites an existing database. Inspect migration checksums and representative fixture records before recording the drill as passed.

The disposable database is retained. Delete it only after verifying its exact name and confirming no application points to it. Production restoration requires a separately reviewed incident procedure; these scripts deliberately do not overwrite production.

## Local verification options

Use `-ComposeFile docker-compose.yml -EnvironmentFile .env.example -DatabaseUser postgres -Database fanpage_sales_agent_test` for a backup of the isolated integration database. For restore, omit `-Database` and retain the disposable target default. Never run integration tests while taking this verification backup because integration setup recreates the test schema.

## Evidence

## Linux VPS

```sh
sh scripts/backup-postgres.sh /secure/backup-directory
sh scripts/restore-postgres.sh /secure/backup-directory/<backup>.dump
```

The Linux scripts retain SHA-256, source revision, migration checksums and core table counts beside the dump. Restore refuses a production database target and compares restored migration checksums and counts. Keep these sidecars with the archive. A real off-host destination remains an operator choice.

No restore success is implied by this runbook. Record the backup checksum, source revision, migration checksums/count, restored table counts, duration and disposable database name in the release report after executing a drill.
