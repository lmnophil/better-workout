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

# Sweep intermediates left behind by a previously crashed run. A SIGKILL mid-dump
# can't fire our cleanup trap, and the leftovers carry a unique timestamp so the
# prune glob below (*.sql.gz) never matches them — they'd just pile up forever.
rm -f "$BACKUP_DIR"/*.partial

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
TARGET="${BACKUP_DIR}/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"
DUMP_TMP="${TARGET}.dump.partial" # uncompressed dump, before gzip
GZIP_TMP="${TARGET}.partial"      # gzipped, before the atomic rename

# Always sweep our own intermediates on exit. The final TARGET has no .partial
# suffix, so a successful run leaves it untouched.
cleanup() {
  rm -f "$DUMP_TMP" "$GZIP_TMP"
}
trap cleanup EXIT

echo "[backup] starting → ${TARGET}"

# Dump and compress as TWO separate steps, deliberately NOT `pg_dump | gzip`. In
# POSIX sh a pipeline's exit status is the LAST command's — gzip's — so a failed
# pg_dump (bad password, db down, dropped connection) sails into the success
# branch and an empty/truncated .sql.gz gets renamed into place as a "good"
# backup, which then ages the real ones out via pruning. We need pg_dump's own
# status, so it writes an uncompressed temp file we check directly. (scripts/CLAUDE.md
# keeps the no-`set -o pipefail` rule; this sidesteps the pipeline entirely.)
#
# --no-owner / --no-privileges keep the dump portable across environments
# (e.g. restoring to a freshly-initialized DB with a different role).
if ! pg_dump \
    --host="$POSTGRES_HOST" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=plain \
    --no-owner \
    --no-privileges \
    --quote-all-identifiers \
    >"$DUMP_TMP"; then
  echo "[backup] pg_dump failed; no backup written" >&2
  exit 1
fi

# pg_dump writes this trailer comment only after streaming the whole database,
# so its presence is positive confirmation the dump ran to completion — not
# merely that the exit code was 0. Cheap guard against a truncated dump being
# published. Grep the whole file (anchored to the exact comment line) rather than
# a fixed `tail -n N` window: recent pg_dump emits a trailing `\unrestrict …`
# line after the trailer, and a tail window would silently start missing the
# marker if that trailing output grows in a future version — turning good backups
# into false failures. The dump is small (single-user DB); a full grep is cheap.
if ! grep -q '^-- PostgreSQL database dump complete$' "$DUMP_TMP"; then
  echo "[backup] dump missing its completion trailer; refusing to publish" >&2
  exit 1
fi

if ! gzip -9 <"$DUMP_TMP" >"$GZIP_TMP"; then
  echo "[backup] gzip failed; no backup written" >&2
  exit 1
fi
rm -f "$DUMP_TMP"

# Verify the gzip stream is intact before publishing — insurance against a
# truncated write (e.g. a full disk) reaching the offsite pipeline.
if ! gzip -t "$GZIP_TMP"; then
  echo "[backup] gzip integrity check failed; no backup written" >&2
  exit 1
fi

# Publish atomically. Until this rename nothing the offsite pipeline globs
# (*.sql.gz) exists, so a partial backup is never visible as a real one.
mv "$GZIP_TMP" "$TARGET"

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
