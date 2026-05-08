#!/bin/sh
# Restore the database from a backup file.
#
# This is destructive: it drops the public schema before restoring. Run only
# when you actually want to roll back. Confirms before doing anything.
#
# Usage:
#   ./scripts/restore.sh /path/to/backup-file.sql.gz
#
# The path is on the HOST filesystem; the script handles getting it into the
# container. Plain .sql files (uncompressed) are also accepted.

set -eu

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  echo "Example: $0 /var/backups/workout/workout-2026-05-07T03-00-00Z.sql.gz" >&2
  exit 1
fi

SOURCE="$1"
if [ ! -f "$SOURCE" ]; then
  echo "Error: backup file not found: $SOURCE" >&2
  exit 1
fi

# Default DB user/db match docker-compose defaults; let env override.
DB_USER="${POSTGRES_USER:-workout}"
DB_NAME="${POSTGRES_DB:-workout}"

cat <<EOF
================================================================
                    DATABASE RESTORE
================================================================
Source:   $SOURCE
Database: $DB_NAME (user $DB_USER)
Container: db (via docker compose)

This will:
  1. DROP all existing data in the '$DB_NAME' database
  2. Restore the schema and data from the backup file

Existing data will be UNRECOVERABLE after this completes unless
you have another backup.
================================================================
EOF

printf "Type 'restore' to proceed, anything else to cancel: "
read -r CONFIRM
if [ "$CONFIRM" != "restore" ]; then
  echo "Cancelled."
  exit 1
fi

# Pick the right pipe based on file extension
case "$SOURCE" in
  *.sql.gz) DECOMPRESS="gunzip -c" ;;
  *.sql)    DECOMPRESS="cat" ;;
  *)
    echo "Error: unrecognized extension. Expected .sql or .sql.gz" >&2
    exit 1
    ;;
esac

echo "[restore] dropping and recreating public schema..."
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL

echo "[restore] streaming backup into the database..."
$DECOMPRESS "$SOURCE" | docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q

echo "[restore] done. Verify the app comes back up:"
echo "  docker compose restart app"
echo "  docker compose logs -f app"
