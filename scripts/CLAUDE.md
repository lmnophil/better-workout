# scripts/CLAUDE.md

Operator scripts. None run inside the Next.js app — they're for setup.

## What each script does

**`generate-secrets.sh`** — Local one-shot. Prints `KEY=value` lines for
`AUTH_SECRET` and `METRICS_TOKEN`. Uses `openssl rand`. Run once during setup;
don't run again unless you're rotating. There's no database password to
generate — the app uses a local SQLite file, not a networked DB.

## Backups

There is no backup script. The database is a single SQLite file on the
`app-data` Docker volume; back it up by copying that file safely — via the
SQLite backup API or while the app is stopped, never a plain `cp` of a live WAL
database. See DEPLOY.md → "Backups".

The old `pg_dump`-based `backup.sh` / `backup-loop.sh` / `restore.sh` were
removed when the app moved from Postgres to SQLite (see the ADR in
[docs/decisions.md](../docs/decisions.md)).
