# CLAUDE.md

You're working on a self-hosted workout tracker. This file is your standing brief — read it once at the start of a session, and let it shape how you think about the code without being a script you follow.

## Read this stance first

A few working agreements that matter more than any specific fact in this document:

**This doc can be wrong.** It's the best understanding at the time it was written. The code is the source of truth. If you find a contradiction, the code wins, and you should update this doc as part of your change. If a decision documented here looks bad to you now, say so — don't quietly work around it. Pushback is welcome.

**Do quality work, but don't gold-plate.** "Best solution" doesn't mean the most clever or the most general. It means: solves the actual problem, fits the codebase's existing style, doesn't introduce premature abstraction, and you'd be comfortable defending the trade-offs. If something feels wrong, say so before writing code.

**Verify, don't assume.** Read the file before editing. Run `npm run typecheck` after meaningful changes. Trace data flow rather than asserting "this should work." Don't assume library APIs from training data — check `package.json` and how the API is used elsewhere in the repo. The Next.js 15 + React 19 + Auth.js v5 + Prisma 7 stack is recent enough that older patterns are real footguns. If you genuinely can't verify something (no environment, blocked flow), say so explicitly rather than implying success.

**Stay in scope.** Don't add features that weren't asked for. Don't refactor things that weren't part of the request. If you find an unrelated issue while working, surface it ("I noticed X — want me to handle it now or leave it for later?") rather than silently fixing it as a drive-by.

**The previous session can be wrong too.** Inheriting a session's direction doesn't mean inheriting its mistakes. If the last thing that happened was a half-finished refactor or a questionable design call, push back rather than continuing it.

## What we're building

A self-hosted workout tracker. Single-user or small-group deployment, runs on the user's own hardware (Proxmox LXC, Oracle Cloud Free Tier, etc.) via Docker Compose. The user logs sets and reps; the app shows them what they did last time, what muscles they've neglected, and where they are versus weekly volume targets.

## Project status: solo dev, disposable data

The user is the only developer, and any data in the database is from their own testing. There are no live users to protect now and none planned — this is a self-host-for-yourself app, not a SaaS in waiting. Concretely:

- **Database is disposable, permanently.** `prisma migrate reset --force` and `docker compose down -v` are normal tools, not last resorts. You do not need to ask before running them.
- **Don't preserve migration history.** When the schema changes, edit the existing `init` migration and re-reset rather than stacking new migrations. There is no "cutover from a staged history" coming.
- **No back-compat shims.** Don't add data-migration glue, fallback fields, deprecation paths, or staged rollouts. Just change the code.
- **No multi-user / SaaS hardening.** Rate limiting, session length, etc. are deliberately loose — leave them. Don't harden against threats this deployment model doesn't have.

## Philosophical stance

The philosophical stance is the most important thing about this app, and the easiest thing to accidentally undo:

- **The app is neutral.** It does not prescribe workouts, suggest exercises, or tell the user what to do. It shows them their own data, and reflects back the structures the user has declared. The original trigger was a user who couldn't follow a fitness program because it was too prescriptive; this app is the opposite of that.
- **Sessions are records, not plans.** A `WorkoutSession` is a date plus a list of sets that happened. There's no "type of day" stored on it. Don't add a `dayFocus` field. Sessions can be *started from* a routine day (via the optional `startedFromRoutineDayId` FK), but the session itself remains a record. The plan lives on the routine, not the session.
- **Templates and routines are user-authored plans.** A template is a named lineup of exercises in chosen order. A routine is the user's ordered cycle of templates ("last time I did A, this time B, then C, then loop"). Both are user-declared structures the app represents back; they are not prescriptions or recommendations. The app does not invent or coach. No streaks, no adherence tracking, no "you missed Wednesday" nags.
- **Coverage drives muscle-level guidance.** The color-graded coverage map is the recovery/balance signal. If we ever add an *algorithmic* recommendation feature, it grows from coverage data, not from any stored plan.
- **Volume targets are configurable defaults, not gospel.** ~10 sets/muscle/week for hypertrophy is baked in; users override per-muscle in settings. Don't tighten the defaults; don't add prescriptive ranges.
- **Built-in vs custom exercises coexist.** The seed is a broad library of common, evidence-based movements drawn from current best practices in the strength-and-conditioning and rehab-coaching space — not any one program. The user assembles their own tailored routine on top of that library, and can add anything else as customs. Built-ins and customs flow through the same model. The starter routines (PPL, Upper/Lower, Full body, Mobility) are well-known canonical splits, not anyone's specific prescription.

If a feature request feels like it's pulling toward "tell the user what to do" (rather than "represent what the user told us"), push back before building it.

## Stack

- **Next.js 15** (App Router, React 19, Server Actions). Stable, not bleeding-edge — but recent enough that older patterns are real footguns.
- **TypeScript** strict throughout.
- **Prisma 7** + **Postgres 16** for persistence. The Rust query engine is gone — queries run through the `@prisma/adapter-pg` driver adapter (see `lib/db.ts`). Generator output goes to `prisma/generated/prisma/` (gitignored), not `node_modules/.prisma`. CLI config lives in `prisma.config.ts` at the repo root, not the deprecated `package.json#prisma` block. Schema changes squash back into the single `init` migration (data is disposable — see project status above and `prisma/CLAUDE.md`).
- **Auth.js v5** (`next-auth@5.0.0-beta`). Google OAuth + Resend magic links. JWT session strategy (1-year lifetime — see `docs/decisions.md` for why).
- **Tailwind 3** + custom design tokens. Warm dark theme, Fraunces / Bricolage Grotesque / JetBrains Mono via `next/font/google` (self-hosted at build time, no runtime CDN call).
- **Pino** for structured JSON logging. **prom-client** for Prometheus metrics.
- **Serwist** for PWA / offline support.
- **Docker Compose** for self-hosted deployment: Postgres + app + a nightly `pg_dump` backup helper. The app publishes port 3000; TLS is the operator's reverse proxy (Caddy / nginx / Traefik on the host), not bundled. `docs/caddy-snippet.example` has a paste-ready Caddy block.

Not used (deliberately):
- No ORM other than Prisma. No raw SQL except `SELECT 1` in the healthcheck.
- No state library (Redux, Zustand, etc). Server actions + React state + one small Context provider for shared prefs is enough.
- No CSS-in-JS. Tailwind only.
- No external error tracking (Sentry etc). The `/api/log/client-error` endpoint + Pino is the pipeline.
- No analytics. None.

## Commands you'll actually run

```
npm run dev          # next dev (use dev:pretty to pipe through pino-pretty)
npm run typecheck    # tsc --noEmit — run after meaningful changes
npm run build        # prisma generate && next build
npm run lint         # next lint
npm run db:seed      # tsx prisma/seed.ts — idempotent, safe to re-run
npm run db:migrate   # prisma migrate dev
npm run db:studio    # prisma studio
```

For a full DB reset see `prisma/CLAUDE.md` — those commands require a consent env var (see next section).

## Destructive Prisma commands require a consent flag

The user has gated `prisma migrate reset` and `prisma migrate dev` behind `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<the user's yes-message>`. Run them like:

```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npx prisma migrate reset --force
```

This is an AI-agent guardrail, not a normal Prisma feature. Full reset recipe and rationale are in `prisma/CLAUDE.md`.

## How to find things

```
app/
  (app)/                   Authenticated routes — workout, coverage, settings
  (auth)/                  Sign-in, magic-link verification
  api/
    auth/[...nextauth]/    Auth.js handler — DON'T add things here
    healthz/               Public health check — used by Docker HEALTHCHECK
    metrics/               Prometheus scrape, gated by METRICS_TOKEN
    log/client-error/      Sink for browser-side error reports
  offline/                 Offline fallback page (served by service worker)
  error.tsx                Root error boundary
  global-error.tsx         Last-resort boundary (root layout failures)
  layout.tsx               HTML shell + fonts
  manifest.ts              PWA manifest
  sw.ts                    Service worker (compiled by Serwist)

components/
  workout/                 The active workout UI (rich, has its own CLAUDE.md)
  coverage/                Coverage view (muscle recency + volume bars)
  settings/                Settings editors (volume targets, rest timer)
  layout/                  App nav
  auth/                    Sign-out button
  ui/                      Cross-cutting UI: confirm dialog, prefs context, etc.

lib/
  actions.ts               Server actions — every mutation goes through here
  queries.ts               Server-side reads (some React.cache'd)
  db.ts                    Prisma client singleton + slow-query logging
  auth helpers             auth.ts (root), auth.config.ts (Edge-safe), middleware.ts
  exercises-data.ts        Seed exercises + MUSCLE_GROUPS list
  logger.ts                Pino instance (auto-redacts emails/tokens)
  metrics.ts               Prometheus registry + counters
  observability.ts         withLogging() wrapper for actions
  env.ts                   Boot-time env validation
  rate-limit.ts            Token-bucket limiter (in-memory)
  request.ts               getClientIp() helper
  utils.ts                 Tiny utilities

prisma/                    Schema + seed (has its own CLAUDE.md)
scripts/                   Backup / restore / secret-gen (has its own CLAUDE.md)
public/                    Static assets, PWA icons
docs/                      Decisions log + reference docs (api, data model, codebase map)

instrumentation.ts         Next.js startup hook — calls validateEnv()
middleware.ts              Edge middleware — auth gate + redirects
auth.ts, auth.config.ts    Auth.js config (split for Edge compatibility)
docker-compose.yml         The deployment (publishes app:3000 to host)
docs/caddy-snippet.example Reference Caddy config for an external reverse proxy
Dockerfile                 Multi-stage build
DEPLOY.md                  Operator-facing deploy guide
README.md                  User-facing project intro
```

## Conventions worth respecting

**Server actions.** Every mutation lives in `lib/actions.ts`, wrapped with `withLogging('actionName', async (...) => {...})`. The wrapper handles timing, metrics, and error categorization. Every action: calls `requireUser()` (never trusts client-provided userId), validates inputs with Zod where they cross the trust boundary, scopes DB queries by userId for ownership, and calls `revalidatePath('/')` (or relevant path) after mutating. Throws strings like `'No active session'` for expected user-facing errors — they're matched in `lib/observability.ts` so they log at warn (not error). If you add a new expected error, add it to `EXPECTED_MESSAGES` there.

**Queries.** `lib/queries.ts`. Server-side only. Some are wrapped with `cache()` from React when multiple callers in one request might fetch the same data (e.g. layout + page both wanting prefs). Don't import these into client components.

**Client components.** Marked `'use client'` at the top. Use `useTransition` to wrap action calls; show `isPending` state on buttons. For shared state across the layout/page boundary, use the `PrefsContext` in `components/ui/prefs-context.tsx` — don't reintroduce prop drilling for prefs.

**Errors.** Server-side: throw expected errors as `Error` with stable message prefixes (see `EXPECTED_MESSAGES`). They bubble to the nearest `error.tsx` boundary. All four boundaries use the `useReportError` hook so client crashes ship to `/api/log/client-error`. Don't add new boundaries that just `console.error`.

**Schema changes.** See `prisma/CLAUDE.md`.

**New API routes.** See `app/api/CLAUDE.md` — there are middleware and rate-limit gotchas.

**Comments.** Prefer prose paragraphs that explain *why*, not bullet lists that restate *what*. The code already says what; comments should add the rationale that isn't obvious. Match the existing voice — direct, doesn't hedge, doesn't apologize.

**Formatting.** No tooling enforced (no Prettier config). Just match what's around you.

## Verifying UI changes

A Playwright MCP is wired up via `.mcp.json` at the repo root. Use it to actually drive the dev server in a browser — navigate, click through flows, screenshot, read the console — instead of saying "I can't verify the UI." Typechecking is not the same as exercising the feature; for UI work, exercise it before reporting done.

The first time the MCP launches a browser, the user signs in manually (Google OAuth or magic link) in the headed window. The profile persists at `./.playwright-profile/` (gitignored) so future sessions land pre-authenticated. If the cookie expires or you need to test as a different user, blow that directory away and re-sign in.

If you genuinely can't verify something (no MCP available, environment doesn't support a headed browser, blocked by an OAuth flow), say so explicitly rather than implying success.

## When you're a fresh session

Only **this file** is required reading. Everything below is a referenced index — consult what the task actually needs rather than pre-loading all of them:

- `docs/codebase-map.md` — point-in-time, code-grounded reference: schema, seeded exercises, action/query index, routes, components, infra. Skim when you need to orient. Header notes when it was generated and how to check staleness — if it's stale enough to mislead, regenerate it (recipe is in the doc) before relying on specific counts or signatures.
- `docs/api.md` — actions, queries, and HTTP routes that exist, what each does, and conventions for adding new ones. Read when you're touching the API surface.
- `docs/data-model.md` — entities, relationships, cross-cutting patterns (soft-delete, ownership scoping, etc.). Read when you're touching schema or data flow.
- `docs/decisions.md` — substantive design decisions and why. Check when you're about to undo or extend a non-obvious choice.
- The relevant subdirectory `CLAUDE.md` (`prisma/`, `app/api/`, `components/workout/`, `scripts/`) when working in that area.
- The actual code files for the change.

Don't read the whole codebase up front. Pull docs in as the task earns them.

## When this doc is wrong

Update it. Write the change in the same voice and ship it as part of your work. A doc that's known to be stale is worse than no doc — future sessions will trust it and get burned.
