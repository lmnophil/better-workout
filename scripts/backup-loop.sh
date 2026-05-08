#!/bin/sh
# Entrypoint for the backup service container.
#
# Runs backup.sh once on start (so a fresh deploy gets a backup immediately
# rather than waiting until 3 AM tomorrow), then runs again every 24h aligned
# to BACKUP_SCHEDULE_HOUR:00 UTC.
#
# We use a simple sleep loop instead of cron because:
#   - The base postgres image doesn't include cron
#   - There's only one job; cron would be more machinery than the problem needs
#   - Date math without GNU/BSD-specific flags is portable across base images
#
# Schedule is controlled by BACKUP_SCHEDULE_HOUR (UTC, 00–23). Default 03.

set -eu

: "${BACKUP_SCHEDULE_HOUR:=03}"

echo "[backup-svc] starting; will run daily at ${BACKUP_SCHEDULE_HOUR}:00 UTC"

run_backup() {
  if sh /usr/local/bin/backup.sh; then
    echo "[backup-svc] backup completed at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  else
    echo "[backup-svc] backup failed at $(date -u +"%Y-%m-%dT%H:%M:%SZ"); will retry at next scheduled time" >&2
  fi
}

# Always run once on container start. Catches the case where the host was
# down at the scheduled time, and gives a fresh deploy a backup immediately.
run_backup

# Compute seconds-until-next-run using only the basic %H and %M format
# specifiers — avoids portability issues with date arithmetic flags.
# Strip leading zeros via sed so the shell doesn't interpret them as octal
# (busybox sh doesn't support bash's 10# notation).
seconds_until_target_hour() {
  hour=$(date -u +"%H" | sed 's/^0*//')
  minute=$(date -u +"%M" | sed 's/^0*//')
  second=$(date -u +"%S" | sed 's/^0*//')
  target=$(echo "$1" | sed 's/^0*//')

  # An empty result from sed (when the value was "00") means zero
  hour=${hour:-0}
  minute=${minute:-0}
  second=${second:-0}
  target=${target:-0}

  now_in_day=$((hour * 3600 + minute * 60 + second))
  target_in_day=$((target * 3600))

  if [ "$now_in_day" -lt "$target_in_day" ]; then
    echo $((target_in_day - now_in_day))
  else
    # Past today's target; wait until tomorrow's
    echo $((86400 - now_in_day + target_in_day))
  fi
}

while true; do
  SLEEP_SEC=$(seconds_until_target_hour "$BACKUP_SCHEDULE_HOUR")
  echo "[backup-svc] sleeping ${SLEEP_SEC}s until next run"
  sleep "$SLEEP_SEC"
  run_backup
done
