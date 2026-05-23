#!/bin/sh
set -eu

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-commander_admin}"
DB_PASSWORD="${DB_PASSWORD:-secret}"
DB_NAME="${DB_NAME:-pwm_tactical_database}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrate/migrations}"

export PGPASSWORD="$DB_PASSWORD"

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"

echo "[MIGRATE] Waiting for Postgres at $DB_HOST:$DB_PORT..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
  sleep 1
done

echo "[MIGRATE] Ensuring schema_migrations table exists..."
$PSQL -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW());"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "[MIGRATE] No migrations directory at $MIGRATIONS_DIR."
  exit 0
fi

found=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  if [ ! -f "$file" ]; then
    continue
  fi

  found=1
  version=$(basename "$file")
  applied=$($PSQL -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version';" | tr -d '[:space:]')

  if [ "$applied" = "1" ]; then
    echo "[MIGRATE] Skipping $version (already applied)."
    continue
  fi

  echo "[MIGRATE] Applying $version..."
  $PSQL -v ON_ERROR_STOP=1 -f "$file"
  $PSQL -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (version) VALUES ('$version');"
  echo "[MIGRATE] Applied $version."
done

if [ "$found" -eq 0 ]; then
  echo "[MIGRATE] No migration files found in $MIGRATIONS_DIR."
fi
