#!/bin/sh
set -eu
umask 077
archive=${1:?Usage: sh scripts/restore-postgres.sh ARCHIVE}
compose_file=${COMPOSE_FILE:-docker-compose.production.yml}
env_file=${APP_ENV_FILE:-.env.production}
db_user=${BACKUP_DATABASE_USER:-fanpage}
target=${RESTORE_DATABASE:-fanpage_sales_agent_restore_$(date -u +%Y%m%d%H%M%S)_$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')}
case "$target" in fanpage_sales_agent_restore_*) ;; *) echo 'Requires separate disposable database' >&2; exit 1;; esac
case "$target:$db_user" in *[!a-z0-9_:]*) echo 'Invalid database identity' >&2; exit 1;; esac
test -f "$archive" && test -f "$archive.sha256" && test -f "$archive.migrations"
expected=$(cat "$archive.sha256")
actual=$(sha256sum "$archive" | cut -d ' ' -f1)
test "$actual" = "$expected" || { echo 'Backup checksum mismatch' >&2; exit 1; }
container=$(docker compose --env-file "$env_file" -f "$compose_file" ps -q postgres)
case "$container" in ''|*[!a-f0-9]*) echo 'Postgres container unavailable' >&2; exit 1;; esac
remote="/tmp/restore-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n').dump"
verify_file=$(mktemp)
trap 'docker exec "$container" rm -f -- "$remote" >/dev/null 2>&1 || true; rm -f -- "$verify_file"' EXIT
docker cp "$archive" "$container:$remote"
docker exec "$container" createdb --username="$db_user" "$target"
docker exec "$container" pg_restore --username="$db_user" --dbname="$target" --exit-on-error --no-owner --no-privileges "$remote"
docker exec "$container" psql --username="$db_user" --dbname="$target" -At -c 'SELECT filename,checksum FROM schema_migrations ORDER BY filename' > "$verify_file"
cmp "$archive.migrations" "$verify_file" || { echo 'Migration checksum verification failed' >&2; exit 1; }
docker exec "$container" psql --username="$db_user" --dbname="$target" -At -c "SELECT 'messages',count(*) FROM messages UNION ALL SELECT 'orders',count(*) FROM orders UNION ALL SELECT 'webhook_events',count(*) FROM webhook_events ORDER BY 1" > "$verify_file"
cmp "$archive.counts" "$verify_file" || { echo 'Restored table counts differ from backup metadata' >&2; exit 1; }
printf 'Restore verified; disposable database retained: %s\n' "$target"
cat "$verify_file"
