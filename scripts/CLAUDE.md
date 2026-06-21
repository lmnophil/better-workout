# scripts/CLAUDE.md

Operator scripts. None of these run inside the Next.js app — they're for setup, backups, and recovery.

## Portability constraint: POSIX sh, not bash

`backup.sh` and `backup-loop.sh` run inside the `postgres:16-alpine` container, which uses **busybox `sh` (ash)**. Bash-isms break silently at runtime, often only on the unhappy path.

What this means in practice:

- No `[[ ... ]]` — use `[ ... ]`.
- No `==` for string comparison in `[ ... ]` — use `=`.
- No `10#$N` for explicit base-10 — use `sed 's/^0*//'` to strip leading zeros (otherwise `08` parses as octal and errors).
- No bash arrays. No process substitution `<(...)`. No `${var,,}` (lowercase).
- No `local` for variables in functions — busybox supports it but it's not POSIX, and habits travel.
- `set -eu` (no `-o pipefail` — also not POSIX, though busybox supports it).

`restore.sh` runs on the **host**, so it can use whatever the host has. Currently it sticks to POSIX sh too because there's no reason not to.

When in doubt, test under busybox:

```bash
docker run --rm -v $PWD/scripts:/s alpine sh /s/backup.sh
```

(Won't actually run the backup — Postgres won't be there — but it'll surface syntax errors.)

## What each script does

**`generate-secrets.sh`** — Local one-shot. Prints `KEY=value` lines for `AUTH_SECRET`, `POSTGRES_PASSWORD`, `METRICS_TOKEN`. Uses `openssl rand`. Run once during setup; don't run again unless rotating.

**`backup.sh`** — Runs inside the `backup` compose service. Dumps to an uncompressed temp file, gzips it as a separate step, verifies the result (dump-completion trailer + `gzip -t`), then renames atomically into `/backups/<dbname>-<ISO-timestamp>.sql.gz`. Any failure writes nothing and exits non-zero. Prunes older files keeping `BACKUP_KEEP_LOCAL` newest. The dump and gzip are split on purpose — see "Atomic writes".

**`backup-loop.sh`** — Entrypoint for the `backup` compose service. Runs `backup.sh` once on container start (so a fresh deploy gets a backup immediately), then sleeps until the next `BACKUP_SCHEDULE_HOUR:00 UTC`, runs again, repeats. Pure sleep loop, no cron.

**`restore.sh`** — Manual host-side helper. Takes a backup file path, confirms (`type 'restore' to proceed`), drops the public schema, pipes the dump back in. Destructive; never automated.

## Atomic writes, and why the dump isn't piped into gzip

`backup.sh` builds a backup through two intermediates — an uncompressed `*.dump.partial`, then a gzipped `*.sql.gz.partial` — and only `mv`s the final file into place once it's verified. This matters because the user's offsite pipeline picks up files from `BACKUP_HOST_DIR` and would otherwise see a half-written file as a real backup. Rename is atomic on POSIX filesystems.

The dump and the gzip are **separate steps on purpose**, not `pg_dump | gzip > file`. In POSIX sh a pipeline's exit status is the _last_ command's — gzip's — so a failed `pg_dump` (bad password, db down, dropped connection) still makes the pipeline succeed; an empty/truncated `.sql.gz` then gets renamed into place and logged as a good backup, and the prune ages the real backups out against it. Writing the dump to a file lets us check `pg_dump`'s own status. Two cheap gates back it up before the rename: the `PostgreSQL database dump complete` trailer must be present (proves a complete dump, not just exit 0), and `gzip -t` must pass.

A `trap cleanup EXIT` removes this run's intermediates on any exit; a `rm -f "$BACKUP_DIR"/*.partial` at the top sweeps leftovers from a previous SIGKILL (which can't fire the trap) — their unique timestamps keep the prune glob from ever catching them.

If you add another script that writes files an external pipeline reads, mirror the pattern.

## Pruning logic

```sh
ls -1t "$BACKUP_DIR"/*.sql.gz | tail -n +"$((KEEP + 1))"
```

`ls -1t` sorts newest first by mtime. `tail -n +N` skips the first `N-1` lines, so `tail -n +8` skips 7 and emits the 8th onward — which are the ones older than our retention. Subtle off-by-one to keep in mind if you change retention.

This relies on filenames being unique, which they are because timestamps include seconds.

## Things you might want to do that would be wrong

- **Adding bash-only syntax.** Test under busybox or you'll break production with no warning until 3 AM tomorrow.
- **Replacing the sleep loop with cron.** The base image doesn't have cron; you'd need to install it; the sleep loop is 30 lines and easier to reason about.
- **Making the backup script encrypt the output.** Explicit user preference: their offsite pipeline encrypts. Don't double-encrypt. See `docs/decisions.md`.
- **Hard-coding the host path or the schedule hour.** Both are env-configurable. Defaults are sensible.
- **Collapsing the dump and gzip back into `pg_dump | gzip > file`.** It reads cleaner and reintroduces the exact bug the split exists to prevent — a failed dump that looks like success because gzip is the pipeline's last command. See "Atomic writes". (And no, the fix isn't `set -o pipefail`; see the next bullet.)
- **Adding `set -o pipefail`.** Not POSIX. Busybox supports it but the habit will bite you on a base image that doesn't.
