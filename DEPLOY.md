# Deployment Guide

End-to-end deployment of the workout tracker. Primary target: an Ubuntu LXC on Proxmox VE. Notes for Oracle Cloud Free Tier are at the bottom.

> For local development and rehearsing the boot path before shipping, see [`LOCAL.md`](./LOCAL.md). It covers running the same compose stack on your laptop and resetting it to a clean state — the closest dry run to a first prod deploy.

## What you'll end up with

- Single Ubuntu container running Docker
- Three containers managed by Docker Compose: Postgres, the Next.js app, a backup helper
- HTTPS handled by your own reverse proxy (Caddy / nginx / Traefik) sitting in front of port 3000
- Auto-applied database migrations on every deploy
- Reachable at `https://your-domain.com`

This stack assumes you already run a reverse proxy on the host (or another box) that terminates TLS and forwards to the app. If you don't, the app still runs — just on plain HTTP at port 3000 — but you don't want that on the public internet.

## Prerequisites

- A domain you control (Cloudflare, Namecheap, Google Domains — anyone)
- Google Cloud project with OAuth credentials
- Resend account with a verified domain (or you can start with Resend's test domain)
- Either: a Proxmox host you can ssh into, _or_ an Oracle Cloud account

---

## Part 1 — Provision the LXC (Proxmox)

In the Proxmox web UI:

1. **Download a template** if you don't have one: `Datacenter → Storage (local) → CT Templates → Download` → `ubuntu-24.04-standard`.
2. **Create the container**: `Create CT` button. Settings:
   - Hostname: `workout` (or whatever)
   - Password / SSH key: your call — SSH keys recommended
   - Template: the Ubuntu 24.04 you downloaded
   - Disk: 16 GB is plenty (the DB + images come in well under 4 GB)
   - CPU: 2 cores
   - Memory: 1024 MB (Postgres + Next.js fits comfortably)
   - Network: DHCP is fine; pin a static lease in your router so port forwarding stays sticky
3. **Enable nesting** so Docker can run inside the LXC: `Container → Options → Features → check Nesting=1`. Restart the container.
4. **(Privileged vs unprivileged)** Unprivileged is the default and works for Docker on modern Proxmox. If Docker misbehaves with weird permission errors, flipping to privileged is a known fix — but try unprivileged first.

SSH into the container as root.

## Part 2 — Install Docker

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates

# Official Docker install script (sets up the apt repo cleanly)
curl -fsSL https://get.docker.com | sh

# Verify
docker --version
docker compose version
```

## Part 3 — Get the code on the box

```bash
mkdir -p /opt/workout && cd /opt/workout
# Either clone from your git host:
#   git clone https://github.com/you/workout-tracker.git .
# Or copy the project files in via scp/rsync from your dev machine.
```

After this step `/opt/workout` should contain the project files (Dockerfile, docker-compose.yml, the source tree, etc).

## Part 4 — DNS + port forwarding + reverse proxy

1. In your DNS provider, create an `A` record pointing `workout.example.com` (or whatever domain you picked) to your home's public IP.
2. On your router, forward ports `80` and `443` to whichever host runs your reverse proxy. Both TCP. (Port 443 also benefits from UDP forwarding for HTTP/3, but it's optional.)
3. Wait a few minutes for DNS propagation. Verify with `dig workout.example.com` from anywhere — should resolve to your public IP.
4. Add a vhost to your reverse proxy that forwards to the app. The app container publishes port 3000. If your reverse proxy is on the same host, that's `localhost:3000`; if it's on a different host, that's `<docker-host-ip>:3000`.

[`docs/caddy-snippet.example`](./docs/caddy-snippet.example) has a paste-ready Caddy block — `reverse_proxy localhost:3000`, sensible security headers, cache directives for `/_next/static/*`, and a 404 on `/api/metrics` so the scrape endpoint isn't reachable from the internet. Adapt it to nginx/Traefik if that's what you run.

> **Your proxy must forward the real host.** Next.js protects Server Actions (every save/log/edit in the app) against CSRF by requiring the browser's `Origin` to match the host the server sees — taken from `X-Forwarded-Host`, or `Host` if that's absent. If your proxy rewrites the `Host` to `localhost:3000` and doesn't set `X-Forwarded-Host`, **pages render fine but every mutation fails** with an "Invalid Server Actions request" error. Caddy sets `X-Forwarded-Host` automatically, so the snippet above just works. On nginx add `proxy_set_header X-Forwarded-Host $host;` (or `proxy_set_header Host $host;`); on Traefik the `Host` is passed through by default. This is why the app does **not** pin `serverActions.allowedOrigins` to a domain — the standalone build is domain-agnostic and the host check covers it.

> **Same-host hardening:** if your reverse proxy is on the same machine as Docker, narrow the published port in `docker-compose.yml` from `'3000:3000'` to `'127.0.0.1:3000:3000'`. The app then only accepts connections from the loopback interface — only your reverse proxy can reach it. The default (all interfaces) is fine for local validation in WSL or for a LAN-only deployment, but tighter is better on a host with a public IP.

## Part 5 — Get auth credentials

You need credentials from two services. Both have generous free tiers — neither charges for this app's traffic profile.

### Google OAuth

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. If you don't have a project, create one. (No billing account required.)
3. **Configure OAuth consent screen** first if prompted — "External" user type, add your email as a test user (or publish if you want anyone to sign up).
4. **Create OAuth client ID** → Web application.
5. Under **Authorized redirect URIs**, add: `https://workout.example.com/api/auth/callback/google` (replace with your real domain).
6. Save the **client ID** (this becomes `AUTH_GOOGLE_ID`) and **client secret** (this becomes `AUTH_GOOGLE_SECRET`).

### Resend

1. Sign up at [resend.com](https://resend.com).
2. **API Keys** → create one with Sending access. Save it (this becomes `AUTH_RESEND_KEY`).
3. **Domains** → add the domain you're sending from. Resend gives you DNS records (SPF, DKIM, DMARC) — add them to your DNS provider. Verification usually takes a few minutes.
4. Once verified, you can send from any address on that domain (e.g. `noreply@example.com`) — that address becomes `AUTH_EMAIL_FROM`.

For testing only, you can skip step 3 and set `AUTH_EMAIL_FROM=onboarding@resend.dev` — Resend's test domain. Magic links from that address only deliver to the email you signed up with, so it's not a real prod option.

## Part 6 — Configure the deployment

```bash
cd /opt/workout
cp .env.example .env
./scripts/generate-secrets.sh >> .env   # appends AUTH_SECRET, POSTGRES_PASSWORD, METRICS_TOKEN
nano .env                                # fill in the rest
```

The `.env` file lives next to `docker-compose.yml`. It's gitignored — never commit it.

### Environment variables — quick reference

Required everywhere (dev and prod):

| Variable             | Where to get it                                                 | Sensitive? |
| -------------------- | --------------------------------------------------------------- | ---------- |
| `AUTH_SECRET`        | `openssl rand -base64 32` (or use generate-secrets.sh)          | **Yes**    |
| `AUTH_URL`           | Your full URL with protocol, e.g. `https://workout.example.com` | No         |
| `AUTH_GOOGLE_ID`     | Google Cloud Console (Part 5)                                   | No         |
| `AUTH_GOOGLE_SECRET` | Google Cloud Console (Part 5)                                   | **Yes**    |
| `AUTH_RESEND_KEY`    | Resend dashboard (Part 5)                                       | **Yes**    |
| `AUTH_EMAIL_FROM`    | Address on your verified Resend domain                          | No         |

Compose-deployment only (used by `docker-compose.yml`):

| Variable               | Where to get it                                                                                                             | Sensitive? |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `POSTGRES_PASSWORD`    | `openssl rand -base64 24` (or use generate-secrets.sh)                                                                      | **Yes**    |
| `POSTGRES_USER`        | Defaults to `workout`. Override only if you have a reason.                                                                  | No         |
| `POSTGRES_DB`          | Defaults to `workout`. Override only if you have a reason.                                                                  | No         |
| `BACKUP_HOST_DIR`      | Host path where DB backups land (e.g. `/var/backups/workout`). Must exist; readable by your offsite pipeline. **Required.** | No         |
| `BACKUP_SCHEDULE_HOUR` | UTC hour for daily backup, 00–23. Default `03`.                                                                             | No         |
| `BACKUP_KEEP_LOCAL`    | How many local backup files to keep before pruning. Default `7`.                                                            | No         |

Local dev only (ignored by compose):

| Variable       | Where to get it                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Connection string for your local Postgres, e.g. `postgres://postgres:devpass@localhost:5432/workout` |

Optional:

| Variable        | Default                       | Notes                                                                                                                    |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `LOG_LEVEL`     | `info` (prod) / `debug` (dev) | Bump to `debug` when investigating                                                                                       |
| `METRICS_TOKEN` | unset                         | Bearer token for `/api/metrics`. If unset, endpoint returns 503. Generate: `openssl rand -hex 32`. **Required in prod.** |

### Boot-time validation

The app validates required env vars on startup (`lib/env.ts`). If `AUTH_SECRET`, `AUTH_URL`, or `DATABASE_URL` are missing or malformed, the container exits with code 1 and logs every problem. Missing OAuth/Resend vars only log warnings — those features become unavailable but the app still boots.

If the app container won't start, `docker compose logs app` shows exactly what's wrong.

### Rotating secrets

If you suspect a secret leaked, replace it and restart:

| Secret               | Effect of rotating                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`        | All existing JWT sessions invalidated → users must sign in again. Do this if leaked.                                                                                                                                                                                                                              |
| `POSTGRES_PASSWORD`  | Postgres only reads this when its data volume is first initialized — editing `.env` and restarting won't rotate a live user's password. Follow the full procedure in "Rotating the Postgres password" (Day-to-day operations); it `ALTER`s the live user, then restarts `app` **and** `backup` so both reconnect. |
| `AUTH_GOOGLE_SECRET` | Generate a new one in Google Cloud Console, paste into `.env`, restart `app`. The old one is invalidated immediately.                                                                                                                                                                                             |
| `AUTH_RESEND_KEY`    | Revoke the old key in Resend dashboard, create a new one, paste into `.env`, restart `app`.                                                                                                                                                                                                                       |
| `METRICS_TOKEN`      | Update the env var, restart `app`, update your scraper's credential.                                                                                                                                                                                                                                              |

Always restart the relevant container after editing `.env`:

```bash
docker compose up -d   # picks up .env changes for affected services
```

## Part 7 — Launch

```bash
cd /opt/workout
docker compose up -d --build
```

First build takes a few minutes — Docker pulls Node and Postgres and builds the Next.js production bundle. After that:

- The `app` container's entrypoint runs `prisma migrate deploy` automatically — schema is created on first boot.
- Postgres comes up with an empty `workout` database.
- The app listens on port 3000. Your reverse proxy (Part 4) handles TLS and forwards to it.

**Seed the built-in exercises (one-time):**

```bash
docker compose exec app node prisma/seed.js
```

Use `exec` against the already-running app container, not `run` — the entrypoint script hardcodes `node server.js` and ignores any args you pass to `run`. The seed script is compiled at build time so it runs with plain `node` (no need for `tsx` in the runtime image). It's idempotent — safe to re-run after updating `lib/exercises-data.ts` and rebuilding.

## Part 8 — Verify

```bash
# All three containers should be up: db, app, backup
docker compose ps

# App logs — look for "Ready" / "Listening on..."
docker compose logs -f app

# From the host, app should answer healthz directly:
curl -s http://localhost:3000/api/healthz
# expect: {"status":"ok","durationMs":...}
```

Then in a browser: `https://workout.example.com` (via your reverse proxy) or `http://localhost:3000` (direct). You should be redirected to `/signin`. Sign in with Google or send yourself a magic link.

## Day-to-day operations

```bash
# Pull updates and rebuild
cd /opt/workout
git pull        # if using git
docker compose up -d --build app

# Check status
docker compose ps

# Tail logs
docker compose logs -f app

# Database shell
docker compose exec db psql -U workout -d workout

# Re-seed (idempotent — re-running won't duplicate)
docker compose exec app node prisma/seed.js
```

### Rotating the Postgres password

Postgres only reads `POSTGRES_PASSWORD` when initializing a fresh data volume — restarting an existing container with a new password value won't change the actual user's password. To rotate it on a live system:

```bash
# 1. Generate a new password
NEW_PW=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)

# 2. Update the live database user (uses the OLD password from .env to connect)
docker compose exec db psql -U workout -d workout -c "ALTER USER workout WITH PASSWORD '$NEW_PW';"

# 3. Update .env with the new password
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$NEW_PW|" .env

# 4. Restart the services that connect to Postgres so they reconnect with the
#    new password. Both `app` and `backup` hold it — restart both, or every
#    nightly dump fails auth from here on.
docker compose up -d app backup
```

## Backups

A `backup` service runs in compose alongside the app. Once a day at `BACKUP_SCHEDULE_HOUR` UTC (default 03 = 3 AM), it runs `pg_dump`, gzips the output, and writes it to the host directory you set as `BACKUP_HOST_DIR`. Older local copies are pruned to `BACKUP_KEEP_LOCAL` (default 7).

The local files are **not encrypted at rest** — the assumption is that you have your own offsite pipeline that handles encryption, transit, and long-term retention. The local copies exist as a short-term buffer if your offsite pipeline is briefly unavailable. If you don't have an offsite pipeline, this setup is not enough on its own — locally on the same disk as the database doesn't protect against host failure.

### Setup

In `.env`:

```env
# Host path where backups land. Your offsite pipeline picks them up from here.
# Must exist and be writable by Docker. No default — be explicit.
BACKUP_HOST_DIR=/var/backups/workout

# UTC hour for daily backup (00–23). Default 03.
BACKUP_SCHEDULE_HOUR=03

# How many local files to retain before pruning oldest. Default 7.
BACKUP_KEEP_LOCAL=7
```

Create the directory before bringing the stack up:

```bash
sudo mkdir -p /var/backups/workout
```

No `chown` is needed. The `backup` service overrides the postgres image's entrypoint, so it runs as **root** and writes to the directory regardless of owner. Dumps land owned by `root:root`, mode `644` (world-readable), so an offsite pipeline reading them as any user works fine. If your pipeline needs to _delete_ or rotate the local copies rather than just read them, run it as root or `sudo chown` the directory to the pipeline's user.

### Verify backups are running

The service runs once on startup, then on schedule:

```bash
docker compose logs backup
# expect: "[backup] starting → /backups/workout-2026-05-07T...sql.gz"
# expect: "[backup] wrote /backups/workout-...sql.gz (XXX KB)"

ls -lh /var/backups/workout/
```

If the host directory is empty after the container starts, check:

- `docker compose logs backup` for permission errors
- That `BACKUP_HOST_DIR` in `.env` matches the directory you created
- That the directory is writable by the `backup` container (it runs as root, so this is rarely the cause)

### Run a manual backup

```bash
docker compose exec backup sh /usr/local/bin/backup.sh
```

Useful before you do anything risky (schema migration, dependency upgrade) or to test the restore procedure.

### Restore from a backup

The `scripts/restore.sh` helper takes a backup file path, drops the existing schema, and pipes the dump back in. **Destructive** — confirms before proceeding.

```bash
./scripts/restore.sh /var/backups/workout/workout-2026-05-07T03-00-00Z.sql.gz
```

Then restart the app so it reconnects:

```bash
docker compose restart app
docker compose logs -f app
```

### Test your restore (do this before you need it)

The most common backup failure mode is "the backups exist but they don't actually restore." Test it once on a non-production DB before rolling out:

```bash
# 1. Take a manual backup
docker compose exec backup sh /usr/local/bin/backup.sh
ls /var/backups/workout/

# 2. Restore from it
./scripts/restore.sh /var/backups/workout/<latest-file>.sql.gz

# 3. Sign in to the app and confirm your data is intact
```

### What's in a backup

`pg_dump --format=plain --no-owner --no-privileges` — every table, index, sequence, and row, as plain SQL. Portable across Postgres environments (the `--no-owner` flag means restore works against a different DB role). You can `zcat backup.sql.gz | head` to read the first lines if you want to verify it looks sensible.

What's NOT in a backup:

- Reverse proxy state (TLS certs etc.) — lives outside this stack now
- App container state — there is none worth preserving
- Uploaded files — there are no file uploads in this app

So the database backup is everything.

## Troubleshooting

**"502 / connection refused via reverse proxy"** — proxy can't reach the app. Check the app is listening on the host: `curl -s http://localhost:3000/api/healthz` from the docker host. If that works, your proxy's upstream address is wrong (cross-host? wrong port? bound to `127.0.0.1` but proxy is on a different host?).

**"OAuthCallbackError: redirect_uri_mismatch"** — the URL in Google Cloud Console doesn't exactly match `${AUTH_URL}/api/auth/callback/google`. Common causes: trailing slash, http vs https mismatch, or `AUTH_URL` set to the bare port (e.g. `http://localhost:3000`) while you're testing through the reverse proxy on `https://workout.example.com`.

**"Magic links never arrive"** — Resend domain isn't fully verified, or `AUTH_EMAIL_FROM` is using a different domain than you verified. Check Resend's dashboard for the email's status.

**"Database connection refused on startup"** — happens occasionally when the app container starts before Postgres is fully ready, despite the `depends_on` healthcheck gate. The entrypoint runs under `set -e`, so a failed migration exits the container non-zero and `restart: unless-stopped` restarts it, re-running the migration — it usually self-heals within a restart or two. If it persists, raise the `db` healthcheck's `start_period` in `docker-compose.yml`.

**"Service worker won't update"** — service workers are sticky. After a deploy, hard-refresh (Cmd+Shift+R / Ctrl+F5) or open dev tools → Application → Service Workers → Unregister.

---

## Observability

The app emits structured JSON logs and Prometheus metrics out of the box. None of this requires extra infrastructure to start using — Docker captures logs to stdout, and you can attach a scraper whenever you're ready.

### Logs

Every server action is wrapped with timing + error tracking. Auth events, slow Prisma queries (> 100ms), and React error boundary catches all flow into the same JSON log stream.

Tail the app logs:

```bash
docker compose logs -f app
```

Pipe to `jq` for filtering — e.g. all errors. The `--no-log-prefix` flag is required: without it Compose prefixes every line with the service name, and `jq` chokes on the non-JSON prefix.

```bash
docker compose logs --no-log-prefix app | jq -c 'select(.level >= 50)'
```

Or all slow actions:

```bash
docker compose logs --no-log-prefix app | jq -c 'select(.msg == "action.slow")'
```

Access logs come from your reverse proxy, not from this stack. The Caddy snippet at [`docs/caddy-snippet.example`](./docs/caddy-snippet.example) emits JSON access logs to stdout — pipe through `jq` the same way.

**Log level:** Set `LOG_LEVEL` in `.env` to `debug` to also see every action's completion timing (including fast ones) and per-query timings. Default `info` is appropriate for prod.

### Metrics

The `/api/metrics` endpoint exposes Prometheus-format metrics, gated by `METRICS_TOKEN`. Generate one and add it to `.env`:

```bash
METRICS_TOKEN=$(openssl rand -hex 32)
echo "METRICS_TOKEN=$METRICS_TOKEN" >> .env
docker compose up -d  # pick up the env change
```

The Caddy snippet 404s `/api/metrics` so it isn't reachable from the public internet — do the same in whatever reverse proxy you run. To scrape it, either run your scraper inside the same compose network (it can reach `app:3000/api/metrics` directly) or hit the host port (`http://localhost:3000/api/metrics`) from a same-host scraper. Example: a Prometheus container in `docker-compose.yml`:

```yaml
prometheus:
  image: prom/prometheus:latest
  restart: unless-stopped
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    - prometheus-data:/prometheus
  networks:
    - internal
```

…with a minimal `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: workout-tracker
    metrics_path: /api/metrics
    authorization:
      credentials: <paste METRICS_TOKEN here>
    static_configs:
      - targets: ['app:3000']
```

To run a quick check from the docker host:

```bash
# wget (busybox), not curl — the node:22-alpine runtime image ships no curl. The
# token is single-quoted so it expands inside the container, where the app
# service has METRICS_TOKEN set — not in your host shell, where it doesn't.
docker compose exec app sh -c \
  'wget -qO- --header="Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/api/metrics' | head -50
```

### Metrics that ship

Prefixed with `workout_tracker_`:

- `action_duration_seconds{action,status}` — histogram of every server action (login, addSet, completeActiveSession, etc.)
- `actions_total{action,status}` — counter form
- `db_query_duration_seconds{operation}` — histogram per Prisma query, bucketed by SQL verb
- `auth_events_total{event,provider}` — sign-ins, sign-outs, signups
- `sessions_completed_total` — workouts marked complete
- `sets_logged_total` — sets added during workouts
- `templates_used_total` — sessions started from a saved template
- `client_errors_total{kind}` — JS errors caught by route or global error boundary
- Default Node.js metrics: process CPU, memory, GC, event loop lag

### Useful PromQL starters

Slow action P95 by name:

```
histogram_quantile(0.95, rate(workout_tracker_action_duration_seconds_bucket[5m]))
```

Error rate by action:

```
sum by (action) (rate(workout_tracker_actions_total{status="error"}[5m]))
```

### Health check

`GET /api/healthz` returns `{"status":"ok"}` with HTTP 200 if the app can reach the database, `{"status":"unhealthy"}` with HTTP 503 if it can't. Both responses include a `durationMs` showing how long the DB round-trip took.

This endpoint backs:

- The Docker `HEALTHCHECK` on the app container (`docker compose ps` shows the status)
- Whatever uptime monitoring or reverse-proxy active health check you wire up

Hit it manually:

```bash
docker compose exec app node healthcheck.cjs && echo "healthy" || echo "unhealthy"
# or from outside:
curl -i https://workout.example.com/api/healthz
```

If you wire up external uptime monitoring (BetterStack, Uptime Kuma, etc.), point it here.

### Log retention

Compose configures all three services with `json-file` rotation: 10MB per file, 5 files, gzip-compressed when rotated. Each service tops out at ~50MB on disk and you can always go back roughly 50MB worth of activity. Adjust the `x-logging:` block at the top of `docker-compose.yml` if you have different needs.

### What to add later

This setup intentionally stops short of bundling Prometheus + Grafana + Loki — they're easy to drop in via a separate compose file once you actually want dashboards. When you're ready, the patterns are:

- **Loki** to aggregate JSON logs (point Promtail or Vector at `docker compose logs`)
- **Prometheus** for scraping `/api/metrics` (see above)
- **Grafana** for dashboards on top of both
- **Alertmanager** when you want pages/alerts

---

## Alternative: Oracle Cloud Free Tier

The same `docker-compose.yml` runs unchanged on an Oracle Cloud Ampere ARM VM. Differences:

1. Provision an **Always Free Ampere A1** instance with Ubuntu 22.04+ (4 OCPUs / 24 GB free).
2. Open ports 80 and 443 in the **VCN security list** _and_ in `iptables`/`ufw` on the VM:
   ```bash
   sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. Use the public IP directly — no port forwarding gymnastics.
4. The Dockerfile is multi-arch friendly; ARM64 build works out of the box.

Otherwise the steps are identical from Part 2 onward.
