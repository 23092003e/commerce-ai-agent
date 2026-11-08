#!/bin/sh
set -eu
umask 077
backup_dir=${1:?Usage: sh scripts/backup-postgres.sh BACKUP_DIRECTORY}
compose_file=${COMPOSE_FILE:-docker-compose.production.yml}
env_file=${APP_ENV_FILE:-.env.production}
db_name=${BACKUP_DATABASE:-fanpage_sales_agent}
db_user=${BACKUP_DATABASE_USER:-fanpage}
case "$db_name:$db_user" in *[!a-z0-9_:]*) echo 'Invalid database identity' >&2; exit 1;; esac
mkdir -p -- "$backup_dir"
backup_dir=$(cd -- "$backup_dir" && pwd -P)
backup_name="fanpage-$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
archive="$backup_dir/$backup_name.dump"
test ! -e "$archive" || { echo 'Refusing existing backup' >&2; exit 1; }
container=$(docker compose --env-file "$env_file" -f "$compose_file" ps -q postgres)
case "$container" in ''|*[!a-f0-9]*) echo 'Postgres container unavailable' >&2; exit 1;; esac
remote="/tmp/$backup_name.dump"
trap 'docker exec "$container" rm -f -- "$remote" >/dev/null 2>&1 || true' EXIT
docker exec "$container" pg_dump --username="$db_user" --dbname="$db_name" --format=custom --file="$remote"
docker cp "$container:$remote" "$archive"
sha256sum "$archive" | cut -d ' ' -f1 > "$archive.sha256"
git rev-parse HEAD > "$archive.revision"
docker exec "$container" psql --username="$db_user" --dbname="$db_name" -At -c 'SELECT filename,checksum FROM schema_migrations ORDER BY filename' > "$archive.migrations"
docker exec "$container" psql --username="$db_user" --dbname="$db_name" -At -c "SELECT 'messages',count(*) FROM messages UNION ALL SELECT 'orders',count(*) FROM orders UNION ALL SELECT 'webhook_events',count(*) FROM webhook_events ORDER BY 1" > "$archive.counts"
printf 'Backup written: %s\n' "$archive"
printf 'SHA256: %s\n' "$(cat "$archive.sha256")"
