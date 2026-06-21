# Workout Tracker

A self-hosted workout tracker that supports flexible, freeform sessions guided by a visual coverage map. Browse exercises (built-in or your own customs), log sets and reps, see what you did last time, and check muscle group coverage so you can decide what to work on next.

The app is deliberately neutral about _how_ you train — no prescribed program, no opinionated suggestions. It just shows you the data: what you've done, what's been neglected, where you are versus your weekly volume targets. You craft the workout.

> **For AI assistants and developers:** start with [`CLAUDE.md`](./CLAUDE.md) at the repo root. It's the standing brief on the project's stance, conventions, and gotchas. Substantive design decisions and the reasoning behind them are in [`docs/decisions.md`](./docs/decisions.md).

## Design principles

- **Sessions are records, not plans.** A session is a date and a list of sets that happened. No "type of day" stored.
- **Coverage drives guidance.** A color-graded map of muscle groups (recently worked → neglected) is the primary signal for what to do today.
- **Volume targets are configurable defaults.** ~10 sets/muscle/week for hypertrophy is baked in; users override per-muscle in settings.
- **Multi-muscle credit is weighted.** Compound lifts credit primary muscles fully and secondary muscles at half. RDLs give your back something, but not full credit.
- **Built-in vs. custom exercises coexist.** The seed is a broad library of common, evidence-based movements drawn from current best practices in the strength-and-conditioning space — not any one program. Users assemble their own routine on top, and can add anything else as customs.

## Features

- Active workout view with reorderable exercises, per-set rep/weight/notes, and a "last time" reference (with notes)
- Coverage view: color-graded recency map + weekly volume bars per muscle, with per-user target overrides
- Rest timer with auto-start, sound + vibration cues, per-exercise overrides, and a one-tap mute toggle in the header
- Named workout templates: save the current lineup, start a fresh session from any saved template
- YouTube demo links on exercises (manually populated; built-ins ship without, customs can include them)
- PWA: installable, offline-friendly
- Auth: Google OAuth + Resend magic-link emails, 1-year session lifetime
- Self-hosted: a single-container Docker Compose stack (SQLite on a volume) you put behind your own reverse proxy

## Stack

- **Next.js 15** (App Router, React 19, Server Actions), **TypeScript** strict
- **Prisma 7** + **SQLite** (driver adapter via `@prisma/adapter-libsql`, no Rust query engine)
- **Auth.js v5** (Google OAuth + Resend magic links)
- **Tailwind 3** + custom design tokens (warm dark theme)
- **Serwist** for PWA / offline support
- **Pino** structured logging, **prom-client** Prometheus metrics
- **Docker Compose** for deployment (bring your own reverse proxy for TLS)

## System architecture

A single-page diagram of the services, the call paths between them, and the external dependencies lives at [`docs/architecture.svg`](./docs/architecture.svg) (also available as [`docs/architecture.pdf`](./docs/architecture.pdf)). Open the SVG in any browser — no tooling required. It's the fastest way to bring a new dev (or returning you) up to speed before reading any code.

For the API surface — the server actions, queries, and HTTP routes the app exposes, with conventions for adding new ones — see [`docs/api.md`](./docs/api.md).

For the data model — entities, relationships, and cross-cutting patterns like soft-delete and ownership scoping — see [`docs/data-model.md`](./docs/data-model.md) (with a static [`data-model.pdf`](./docs/data-model.pdf) for offline viewing).

## Project layout

```
workout-tracker/
├── CLAUDE.md                    Standing brief for any session working on this code
├── README.md                    You are here
├── DEPLOY.md                    End-to-end deployment guide
├── CADDY.md                     Putting an external Caddy in front of the app
├── docs/
│   └── decisions.md             Substantive decisions + reasoning
├── app/                         Next.js App Router
│   ├── (app)/                   Authenticated routes (workout, coverage, settings)
│   ├── (auth)/                  Sign-in, magic-link verification
│   ├── api/                     Auth handler, healthz, metrics, client-error sink
│   ├── layout.tsx, error.tsx, global-error.tsx, manifest.ts, sw.ts
├── components/
│   ├── workout/                 Active workout UI (has its own CLAUDE.md)
│   ├── coverage/                Coverage view
│   ├── settings/                Settings editors
│   ├── layout/                  App nav
│   ├── auth/                    Sign-out button
│   ├── ui/                      Cross-cutting (confirm dialog, prefs context, etc.)
├── lib/
│   ├── actions.ts               Server actions
│   ├── queries.ts               Server-side reads
│   ├── db.ts                    Prisma client + slow-query logging
│   ├── logger.ts, metrics.ts    Pino + prom-client
│   ├── observability.ts         withLogging() wrapper
│   ├── env.ts                   Boot-time validation
│   ├── rate-limit.ts, request.ts, exercises-data.ts, utils.ts
├── prisma/                      Schema, migrations, seed (has its own CLAUDE.md)
├── scripts/                     Secret generation (has its own CLAUDE.md)
├── public/                      Static assets, PWA icons
├── auth.ts, auth.config.ts      Auth.js config (split for Edge compatibility)
├── middleware.ts                Edge middleware — auth gate
├── instrumentation.ts           Next.js startup hook (env validation)
├── docker-compose.yml           The deployment
├── Dockerfile                   Multi-stage build
└── docs/caddy-snippet.example   Reference Caddy config for an external reverse proxy
```

## Local development

See [`LOCAL.md`](./LOCAL.md) for the full local-dev setup — npm mode for everyday hot-reload work, compose mode for verifying the production stack locally, and how to reset either environment to a fresh state.

## Required external accounts

All free for this app's traffic profile. None require payment.

- **Google OAuth** — sign-in with Google. Get credentials at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials).
- **Resend** — magic-link emails. Free tier covers 3,000/month, 100/day. Get an API key at [resend.com](https://resend.com).

See [`DEPLOY.md`](./DEPLOY.md) for the full setup walkthrough.

## Observability

The app emits structured JSON logs (Pino) to stdout and Prometheus metrics at `/api/metrics` (gated by `METRICS_TOKEN`). Server actions, slow Prisma queries (>100ms), auth events, and React error boundary catches all flow into the same pipeline.

```bash
# Tail app logs
docker compose logs -f app

# All errors (--no-log-prefix so jq sees raw JSON, not Compose's line prefix):
docker compose logs --no-log-prefix app | jq -c 'select(.level >= 50)'

# Slow queries:
docker compose logs --no-log-prefix app | jq -c 'select(.msg == "db.slow_query")'
```

Full details (PromQL examples, log filtering recipes, optional Prometheus + Grafana setup) in [`DEPLOY.md`](./DEPLOY.md#observability).

## Backups

The database is a single SQLite file on a Docker volume. There's no backup service — you copy the file safely (online `VACUUM INTO`, or stop-and-copy; never a plain `cp` of a live WAL database) and hand it to your own offsite pipeline (encryption, transit, long-term retention).

A copy on the same disk as the database doesn't survive a host failure — if you don't already have an offsite pipeline, this isn't enough on its own.

See [`DEPLOY.md`](./DEPLOY.md#backups) for setup, restore procedure, and a "test your restore before you need it" checklist.

## Deployment

See [`DEPLOY.md`](./DEPLOY.md) for an end-to-end deployment to a Proxmox LXC (or Oracle Cloud Free Tier), including DNS, port forwarding, OAuth + Resend setup, observability, and backups.
