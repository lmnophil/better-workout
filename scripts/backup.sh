#!/bin/sh
# Database backup script — runs inside the `backup` compose service.
#
# Produces a gzipped SQL dump in /backups/<timestamp>.sql.gz, then prunes the
# oldest files so only BACKUP_KEEP_LOCAL files remain. The host directory
# /backups maps to BACKUP_HOST_DIR on the host (set in .env), where your
# existing offsite pipeline picks them up.
#
# Backups are NOT encrypted at rest — the offsite pipeline is responsible for
# encryption, transit, and long-term retention. The local copies exist only as
# a short-term buffer in case the offsite pipeline is briefly unavailable.

set -eu

# ---- Required env (set by docker-compose) -----------------------------------
: "${POSTGRES_HOST:=db}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${PGPASSWORD:?PGPASSWORD must be set (mapped from POSTGRES_PASSWORD)}"
: "${BACKUP_KEEP_LOCAL:=7}"

BACKUP_DIR="/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
TARGET="${BACKUP_DIR}/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"
TARGET_TMP="${TARGET}.partial"

echo "[backup] starting → ${TARGET}"

# Dump to a .partial file first so a failure mid-dump doesn't leave a half-baked
# file that looks like a real backup to the offsite pipeline. Rename atomically
# only after pg_dump succeeds end-to-end.
#
# --no-owner / --no-privileges keep the dump portable across environments
# (e.g. restoring to a freshly-initialized DB with a different role).
if pg_dump \
    --host="$POSTGRES_HOST" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=plain \
    --no-owner \
    --no-privileges \
    --quote-all-identifiers \
    | gzip -9 > "$TARGET_TMP"; then
  mv "$TARGET_TMP" "$TARGET"
else
  echo "[backup] pg_dump failed; cleaning up partial file" >&2
  rm -f "$TARGET_TMP"
  exit 1
fi

SIZE=$(du -h "$TARGET" | awk '{print $1}')
echo "[backup] wrote ${TARGET} (${SIZE})"

# Prune old backups, keeping the newest BACKUP_KEEP_LOCAL files. Sorted by
# filename — works because timestamps are ISO 8601 and lexicographic order
# matches chronological order.
KEEP="${BACKUP_KEEP_LOCAL}"
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  PRUNE_COUNT=$((COUNT - KEEP))
  echo "[backup] pruning $PRUNE_COUNT old backup(s) (keeping newest $KEEP)"
  # ls -1t orders newest first, so tail skips the ones we keep.
  ls -1t "$BACKUP_DIR"/*.sql.gz | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "[backup] pruning $old"
    rm -f "$old"
  done
fi

echo "[backup] done"
