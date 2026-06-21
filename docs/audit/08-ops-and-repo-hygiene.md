# Package 8: Ops and repo hygiene

Read [README.md](README.md) first, plus `scripts/CLAUDE.md` and `prisma/CLAUDE.md`. Line
numbers as of `94365db`. Pure infra — no app code. Several items are docs-accuracy fixes;
verify each claim against the current file before "fixing" it.

## Findings

1. **`backup.sh` masks `pg_dump` failures** (scripts/backup.sh:37-51) — the worst finding in
   the audit's ops pass. The success test is `if pg_dump … | gzip -9 > "$TMP"; then mv …`. In
   POSIX sh a pipeline's status is the LAST command's (gzip's), so a failed dump (bad password,
   db down, connection drop) still takes the success branch: an empty/truncated `.sql.gz` is
   atomically renamed into place, logged as success, and the prune then ages real backups out
   against it. Fix without `set -o pipefail` if you can honor scripts/CLAUDE.md's
   POSIX-portability rule (e.g. dump to a temp file, then gzip as a second step) — but
   correctness wins over the doc rule if they conflict; busybox ash does support pipefail.
   Update scripts/CLAUDE.md to whatever you decide. Also make the backup verifiable: consider
   a cheap sanity check (non-trivial size / `gzip -t` / grep for the dump trailer) before the
   rename.

2. **`.dockerignore` misses sensitive/heavy paths** — `COPY . .` (Dockerfile:38) pulls
   `.playwright-profile/` (live Auth.js session cookie — the repo's own .gitignore calls it
   "live credentials"), `.playwright-mcp/` (page snapshots), `backups/` (real DB dumps if
   populated), `tsconfig.tsbuildinfo`, `.claude/` into the builder layer. They don't reach the
   runtime image but persist in build cache and leak if the image/cache is pushed or built on
   the prod box from an rsync'd tree (which DEPLOY.md suggests). Add them all.

3. **Password-rotation doc leaves the backup container on stale credentials**
   (DEPLOY.md:232-248): step 4 restarts only `app`; the `backup` service keeps the old
   `PGPASSWORD`, every nightly dump fails auth from then on — and with finding 1, each failure
   still writes a "good" empty backup. Fix the doc (`docker compose up -d` or include
   `backup`).

4. **DEPLOY.md inaccuracies** (verify each, then fix):
   - :355 claims "the entrypoint will retry the migration once" — entrypoint.sh is `set -e`,
     no retry; the real mechanism is container exit + `restart: unless-stopped`.
   - :276 `chown 999:999` annotated as "postgres in the alpine image" — alpine postgres is
     UID 70; 999 is the Debian image. Verify which image compose actually uses and make the
     doc match reality (and check root-owned dumps are readable by the offsite pipeline).
   - :432 `docker compose exec app curl …` — `node:22-alpine` has no curl (busybox
     `wget -qO- --header=…` works), and `$METRICS_TOKEN` expands on the host shell.
   - :378-384 `docker compose logs app | jq …` won't parse — compose prefixes lines; needs
     `--no-log-prefix`.
   - If Package 7 changed `allowedOrigins` handling or the metrics query-param, document the
     operator steps here.

5. **`prisma` CLI is a runtime requirement declared as a devDependency** (entrypoint.sh:10,
   package.json): the runtime image's `npm ci --omit=dev` only installs it by accident
   (`@prisma/client` lists `prisma` as an optional peer → lockfile marks it `devOptional`).
   Move `prisma` to `dependencies` to make the requirement explicit.

6. **Smaller items:**
   - `healthcheck.cjs:10` hardcodes port 3000 — use `process.env.PORT ?? 3000`.
   - `resend` in package.json is unused (magic links go through `next-auth/providers/resend`,
     which uses fetch). Confirm with a grep, then remove.
   - Stray repo-root artifacts: `Caddyfile/` is an empty ROOT-OWNED directory (old Docker
     bind-mount artifact — needs `sudo rmdir`; if you can't sudo, tell the user to) and
     `{prisma,lib,app,components,public}/` is an empty brace-expansion accident (`rmdir` it).
     When `Caddyfile/` is gone, also remove the now-pointless `Caddyfile` line from
     `.dockerignore`. Neither is git-tracked.

## Constraints

- The Dockerfile/compose fundamentals were audited clean (standalone output, prisma generate,
  non-root, healthchecks, log rotation, volume layout) — don't churn them.
- scripts/CLAUDE.md's POSIX rule: push back in-doc if you override it (finding 1).
- Logger redaction and metrics fail-closed behavior are correct — leave them.

## Verification

- Backup: run the backup container (or script directly) against (a) a healthy db → valid
  gzip with plausible size, `gzip -t` passes, dump trailer present; (b) a wrong password →
  script FAILS, no new file renamed into place, prior backups untouched.
- `docker build` the image, then inspect the builder layer (`docker build --target=<builder>`
  - `docker run … ls -la`) to confirm `.playwright-profile` et al. are absent.
- Full `docker compose up` from scratch boots: migrate deploy runs, healthchecks go healthy,
  app serves.
- For each DEPLOY.md command you touched, run the corrected command for real.
- `npm run typecheck && npm run lint` (should be untouched, but cheap).
