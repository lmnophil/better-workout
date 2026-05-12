# CLAUDE.md

You're working on a self-hosted workout tracker. This file is your standing brief — read it once at the start of a session, and let it shape how you think about the code without being a script you follow.

## Read this stance first

A few working agreements that matter more than any specific fact in this document:

**This doc can be wrong.** It's the best understanding at the time it was written. The code is the source of truth. If you find a contradiction, the code wins, and you should update this doc as part of your change. If a decision documented here looks bad to you now, say so — don't quietly work around it. We've demonstrated the value of pushback already; the audits in this project's history caught real bugs in code that earlier sessions wrote confidently.

**Do quality work, but don't gold-plate.** "Best solution" doesn't mean the most clever or the most general. It means: solves the actual problem, fits the codebase's existing style, doesn't introduce premature abstraction, and you'd be comfortable defending the trade-offs. If something feels wrong, say so before writing code. If you find an unrelated issue while working, mention it; don't silently fix it as a drive-by.

**Verify, don't assume.** Read the file before editing it. Run `npm run typecheck` after meaningful changes. Don't claim a feature works because it "should" — actually trace the data flow. Don't assume a library API based on training data — check the version we're on (`package.json`) and look at how it's used elsewhere in the repo. The Next.js 15 + React 19 + Auth.js v5 + Prisma 7 stack is recent enough that older patterns are real footguns.

**The previous session can be wrong too.** Inheriting a session's direction doesn't mean inheriting its mistakes. If the last thing that happened was a half-finished refactor or a questionable design call, you can push back rather than continuing it.

## What we're building

A self-hosted workout tracker. Single-user or small-group deployment, runs on the user's own hardware (Proxmox LXC, Oracle Cloud Free Tier, etc.) via Docker Compose. The user logs sets and reps; the app shows them what they did last time, what muscles they've neglected, and where they are versus weekly volume targets.

## Project status: pre-production, solo dev

There are no live users and no production deployment yet. The user is the only developer. Concretely:

- **Database is disposable.** No data needs to be preserved. `prisma migrate reset --force` and `docker compose down -v` are both fine; treat them as normal tools, not last resorts.
- **Don't preserve migration history.** When the schema changes, prefer editing the existing `init` migration and re-resetting over stacking new migrations on top. The first prod deploy will be a fresh `init`, not a cutover from a staged history.
- **No back-compat shims.** Don't add data-migration glue, fallback fields, deprecation paths, or staged rollouts. Just change the code.
- **No multi-user concerns.** Don't harden against threats this single-dev / soon-self-hosted model doesn't have. Rate limiting, session length, etc. are already deliberately loose — leave them.

This calculus flips the moment the user actually deploys to prod with real data. If you see signs of that (a backup pipeline being exercised, the user mentioning a real first user, mention of cutover), pause and re-read this section before recommending destructive ops.

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
- **Prisma 7** + **Postgres 16** for persistence. The Rust query engine is gone — queries run through the `@prisma/adapter-pg` driver adapter (see `lib/db.ts`). Generator output goes to `prisma/generated/prisma/` (gitignored), not `node_modules/.prisma`. CLI config lives in `prisma.config.ts` at the repo root, not the deprecated `package.json#prisma` block. While we're pre-prod, prefer rewriting the `init` migration + reset over adding incremental migrations (see project status section above).
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
docs/                      Decisions log, roadmap

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

## Working agreements (the boring but important stuff)

- **Read before edit.** Open the file before changing it, even if you "remember" it.
- **Typecheck after meaningful changes.** `npm run typecheck`. The TypeScript types in this codebase are load-bearing.
- **One thing at a time.** If you find a separate issue while working, mention it and ask before fixing. Drive-by changes hide in unrelated diffs and become hard to review.
- **Don't expand scope without saying so.** "While I was at it" changes are how codebases get worse over time. If you see something worth fixing, say "I noticed X — want me to handle it now or leave it for later?"
- **Don't ship sloppy.** "It works on my machine" isn't enough. Trace the data flow. Verify the assertion. If you can't verify it, say so explicitly: "I've made the change but haven't been able to verify Y."
- **Push back when things feel off.** A request that's underspecified, contradictory, or pointing toward a bad design — say so. Don't just execute. The user has explicitly asked for this kind of feedback throughout the project's history.
- **Stay in your lane.** Don't add features that weren't asked for. Don't refactor things that weren't part of the request. Don't change conventions that were deliberate.

## Verifying UI changes

A Playwright MCP is wired up via `.mcp.json` at the repo root. Use it to actually drive the dev server in a browser — navigate, click through flows, screenshot, read the console — instead of saying "I can't verify the UI." Typechecking is not the same as exercising the feature; for UI work, exercise it before reporting done.

The first time the MCP launches a browser, the user signs in manually (Google OAuth or magic link) in the headed window. The profile persists at `./.playwright-profile/` (gitignored) so future sessions land pre-authenticated. If the cookie expires or you need to test as a different user, blow that directory away and re-sign in.

If you genuinely can't verify something (no MCP available, environment doesn't support a headed browser, blocked by an OAuth flow), say so explicitly rather than implying success.

## What this app deliberately does NOT have

These are not oversights — pushing back if asked to add them is fair:

- **App-prescribed workouts / "you should do X today"** — see philosophical stance above. Routines surface "today's day" because the user *told* the app what comes next; the app doesn't invent it. Anything that has the app picking exercises or sequencing without user authorship is out of scope.
- **Streaks, adherence tracking, gamification** — directly conflicts with neutral-tool stance.
- **Social features** (friends, sharing, leaderboards) — single-user app.
- **Trainer/PT relationships** — discussed and deferred (see `docs/roadmap.md`).
- **Public-internet multi-user SaaS hardening** — designed for self-host. Rate limits are in-memory; sessions are 1 year; admin tooling is mostly absent. Don't add Redis or harden against threats this deployment model doesn't have.
- **Encryption at rest of backups** — the user's offsite pipeline handles encryption. We deliberately don't double-encrypt.
- **Recommendation engines, ML, AI features.** No.

If a request seems to push in any of these directions, surface the tension before building.

## When you're a fresh session

Read in this order:

1. This file (you're here).
2. `docs/codebase-map.md` — point-in-time, code-grounded reference: schema, seeded exercises, action/query index, routes, components, infra. Skim instead of re-discovering the codebase. Header notes when it was generated and how to check staleness — if it's stale enough to mislead, regenerate it (recipe is in the doc) before relying on specific counts or signatures.
3. `docs/architecture.svg` — one-page diagram of the services and how they call each other. Faster orientation than reading code.
4. `docs/api.md` — the actions, queries, and HTTP routes that exist, what each does, and the conventions for adding new ones.
5. `docs/data-model.md` — the entities, their relationships, and cross-cutting patterns (soft-delete, ownership scoping, etc.).
6. `docs/decisions.md` — the substantive design decisions and why.
7. `docs/roadmap.md` — what's deferred and why, so you don't suggest things we already discussed and chose not to do.
8. The relevant subdirectory `CLAUDE.md` if you're working in `prisma/`, `app/api/`, `components/workout/`, or `scripts/`.
9. The actual code files involved in the change.

Don't read the whole codebase up front. The structure above is enough to navigate.

## When this doc is wrong

Update it. Write the change in the same voice and ship it as part of your work. A doc that's known to be stale is worse than no doc — future sessions will trust it and get burned.
