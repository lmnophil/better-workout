# Deployment Guide

End-to-end deployment of the workout tracker. Primary target: an Ubuntu LXC on Proxmox VE. Notes for Oracle Cloud Free Tier are at the bottom.

## What you'll end up with

- Single Ubuntu container running Docker
- Three containers managed by Docker Compose: Postgres, the Next.js app, Caddy
- HTTPS via Let's Encrypt, automatically renewed
- Auto-applied database migrations on every deploy
- Reachable at `https://your-domain.com`

## Prerequisites

- A domain you control (Cloudflare, Namecheap, Google Domains — anyone)
- Google Cloud project with OAuth credentials
- Resend account with a verified domain (or you can start with Resend's test domain)
- Either: a Proxmox host you can ssh into, *or* an Oracle Cloud account

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

After this step `/opt/workout` should contain the project files (Dockerfile, docker-compose.yml, Caddyfile, the source tree, etc).

## Part 4 — DNS + port forwarding

1. In your DNS provider, create an `A` record pointing `workout.example.com` (or whatever domain you picked) to your home's public IP.
2. On your router, forward ports `80` and `443` to the LXC's IP. Both TCP. (Port 443 also benefits from UDP forwarding for HTTP/3, but it's optional.)
3. Wait a few minutes for DNS propagation. Verify with `dig workout.example.com` from anywhere — should resolve to your public IP.

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

| Variable | Where to get it | Sensitive? |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` (or use generate-secrets.sh) | **Yes** |
| `AUTH_URL` | Your full URL with protocol, e.g. `https://workout.example.com` | No |
| `AUTH_GOOGLE_ID` | Google Cloud Console (Part 5) | No |
| `AUTH_GOOGLE_SECRET` | Google Cloud Console (Part 5) | **Yes** |
| `AUTH_RESEND_KEY` | Resend dashboard (Part 5) | **Yes** |
| `AUTH_EMAIL_FROM` | Address on your verified Resend domain | No |

Compose-deployment only (used by `docker-compose.yml`):

| Variable | Where to get it | Sensitive? |
|---|---|---|
| `DOMAIN` | Bare domain (no protocol), e.g. `workout.example.com`. Caddy uses this to obtain the TLS cert. | No |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` (or use generate-secrets.sh) | **Yes** |
| `POSTGRES_USER` | Defaults to `workout`. Override only if you have a reason. | No |
| `POSTGRES_DB` | Defaults to `workout`. Override only if you have a reason. | No |
| `BACKUP_HOST_DIR` | Host path where DB backups land (e.g. `/var/backups/workout`). Must exist; readable by your offsite pipeline. **Required.** | No |
| `BACKUP_SCHEDULE_HOUR` | UTC hour for daily backup, 00–23. Default `03`. | No |
| `BACKUP_KEEP_LOCAL` | How many local backup files to keep before pruning. Default `7`. | No |

Local dev only (ignored by compose):

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Connection string for your local Postgres, e.g. `postgres://postgres:devpass@localhost:5432/workout` |

Optional:

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` (prod) / `debug` (dev) | Bump to `debug` when investigating |
| `METRICS_TOKEN` | unset | Bearer token for `/api/metrics`. If unset, endpoint returns 503. Generate: `openssl rand -hex 32`. **Required in prod.** |

### Boot-time validation

The app validates required env vars on startup (`lib/env.ts`). If `AUTH_SECRET`, `AUTH_URL`, or `DATABASE_URL` are missing or malformed, the container exits with code 1 and logs every problem. Missing OAuth/Resend vars only log warnings — those features become unavailable but the app still boots.

If the app container won't start, `docker compose logs app` shows exactly what's wrong.

### Rotating secrets

If you suspect a secret leaked, replace it and restart:

| Secret | Effect of rotating |
|---|---|
| `AUTH_SECRET` | All existing JWT sessions invalidated → users must sign in again. Do this if leaked. |
| `POSTGRES_PASSWORD` | Update the env var, restart the `db` and `app` containers together. Postgres re-reads the password on container restart only if the user is recreated — see "Rotating Postgres password" in Day-to-day operations. |
| `AUTH_GOOGLE_SECRET` | Generate a new one in Google Cloud Console, paste into `.env`, restart `app`. The old one is invalidated immediately. |
| `AUTH_RESEND_KEY` | Revoke the old key in Resend dashboard, create a new one, paste into `.env`, restart `app`. |
| `METRICS_TOKEN` | Update the env var, restart `app`, update your scraper's credential. |

Always restart the relevant container after editing `.env`:

```bash
docker compose up -d   # picks up .env changes for affected services
```

## Part 7 — Launch

```bash
cd /opt/workout
docker compose up -d --build
```

First build takes a few minutes — Docker pulls Node, Postgres, Caddy, and builds the Next.js production bundle. After that:

- The `app` container's entrypoint runs `prisma migrate deploy` automatically — schema is created on first boot.
- Caddy provisions a Let's Encrypt cert. You'll see this in the logs (`docker compose logs caddy`). Takes ~30 seconds the first time.
- Postgres comes up with an empty `workout` database.

**Seed the built-in exercises (one-time):**

```bash
docker compose run --rm app node prisma/seed.js
```

The seed script is compiled at build time so it runs with plain `node` (no need for `tsx` in the runtime image). It's idempotent — safe to re-run after updating `lib/exercises-data.ts` and rebuilding.

## Part 8 — Verify

```bash
# All three containers should be up
docker compose ps

# App logs — look for "Ready" / "Listening on..."
docker compose logs -f app

# Caddy logs — look for cert provisioning success
docker compose logs caddy
```

Then in a browser: `https://workout.example.com`. You should be redirected to `/signin`. Sign in with Google or send yourself a magic link.

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
docker compose run --rm app node prisma/seed.js
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

# 4. Restart app so it reconnects with the new password
docker compose up -d app
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
sudo chown 999:999 /var/backups/workout   # 999 is postgres in the alpine image
```

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
- That the directory is writable by UID 999

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
- Caddy TLS certificates (in the `caddy-data` volume) — Caddy re-obtains them automatically on restore
- App container state — there is none worth preserving
- Uploaded files — there are no file uploads in this app

So the database backup is everything.

## Troubleshooting

**"Caddy can't get a cert"** — DNS hasn't propagated, or ports 80/443 aren't reaching the LXC. Test from the public internet: `curl -I http://workout.example.com` should reach Caddy.

**"OAuthCallbackError: redirect_uri_mismatch"** — the URL in Google Cloud Console doesn't exactly match `${AUTH_URL}/api/auth/callback/google`. Common cause: trailing slash, or http vs https mismatch.

**"Magic links never arrive"** — Resend domain isn't fully verified, or `AUTH_EMAIL_FROM` is using a different domain than you verified. Check Resend's dashboard for the email's status.

**"Database connection refused on startup"** — happens occasionally when the app container starts before Postgres is fully ready, despite the healthcheck. The entrypoint will retry the migration once. If it persists, raise the healthcheck's `start_period` in `docker-compose.yml`.

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

Pipe to `jq` for filtering — e.g. all errors:

```bash
docker compose logs app | jq -c 'select(.level >= 50)'
```

Or all slow actions:

```bash
docker compose logs app | jq -c 'select(.msg == "action.slow")'
```

Caddy's access logs (also JSON, on stdout) live in the `caddy` container:

```bash
docker compose logs caddy | jq -c '. | {ts: .ts, status: .status, uri: .request.uri, dur_ms: (.duration * 1000 | floor)}'
```

**Log level:** Set `LOG_LEVEL` in `.env` to `debug` to also see every action's completion timing (including fast ones) and per-query timings. Default `info` is appropriate for prod.

### Metrics

The `/api/metrics` endpoint exposes Prometheus-format metrics, gated by `METRICS_TOKEN`. Generate one and add it to `.env`:

```bash
METRICS_TOKEN=$(openssl rand -hex 32)
echo "METRICS_TOKEN=$METRICS_TOKEN" >> .env
docker compose up -d  # pick up the env change
```

Caddy is configured to **404 the public-facing path**, so the endpoint is only reachable from inside the Docker network. To scrape it, run your scraper in the same compose network. Example: a Prometheus container in `docker-compose.yml`:

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

To run a quick check from your laptop:

```bash
docker compose exec app curl -s -H "Authorization: Bearer $METRICS_TOKEN" \
  http://localhost:3000/api/metrics | head -50
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
- Caddy's `depends_on: app: condition: service_healthy` — so Caddy waits for the app to be ready before accepting traffic, avoiding the "502 for 30s after deploy" window

Hit it manually:

```bash
docker compose exec app node healthcheck.js && echo "healthy" || echo "unhealthy"
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
2. Open ports 80 and 443 in the **VCN security list** *and* in `iptables`/`ufw` on the VM:
   ```bash
   sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. Use the public IP directly — no port forwarding gymnastics.
4. The Dockerfile is multi-arch friendly; ARM64 build works out of the box.

Otherwise the steps are identical from Part 2 onward.
