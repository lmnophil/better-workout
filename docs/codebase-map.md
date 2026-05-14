# Codebase map

A code-grounded reference for orienting in this repo. Skim before re-discovering the codebase. For _rationale_ read [decisions.md](decisions.md); for _working agreements_ read the root [CLAUDE.md](../CLAUDE.md).

This doc describes shapes and invariants, not exhaustive lists. It deliberately avoids enumerating every action, query, or exercise — the code is the canonical list, and copied lists drift. Specific counts (number of exercises, equipment types, etc.) are also kept out for the same reason: read the seed file when you need an exact number.

The doc is maintained alongside code changes (see the maintenance contract in the root [CLAUDE.md](../CLAUDE.md)). If you find a claim here that no longer matches the code, fix the doc as part of your change.

---

## TL;DR

Self-hosted workout tracker. Next.js 15 App Router + React 19 + TypeScript strict + Prisma 7 + Postgres 16, deployed via Docker Compose (postgres + app + nightly pg_dump backup). Auth.js v5 with Google OAuth + Resend magic links, JWT sessions. Single-user / small-group; data is disposable by design (see project status section in CLAUDE.md). Mutations go through server actions in `lib/actions.ts`; reads go through `lib/queries.ts`. The two routine concepts to internalise: a **WorkoutSession is a record of what happened** (date + sets), a **Routine is the user's declared plan** (a cycle of templates) — the app does not invent or prescribe.

---

## 1. Database schema (`prisma/schema.prisma`)

### Auth tables (Auth.js v5)

- **User** — id (cuid), name, email (unique), emailVerified, image; relations to everything user-owned. No soft-delete; cascades on user delete.
- **Account** — OAuth provider rows. FK userId Cascade. Unique (provider, providerAccountId).
- **AuthSession** — JWT strategy is in use, but Auth.js requires this schema. sessionToken unique.
- **VerificationToken** — magic-link tokens; unique (identifier, token).

### Exercise model

- **Exercise** — id, name, module (one of `EXERCISE_MODULES`), prescription, `metric` (`'reps'|'time'`, default `'reps'`), `loadType` (`'weight'|'band'|'none'`, default `'weight'`), `equipment` (string[]), `primaryMuscles[]`, `secondaryMuscles[]`, `videoUrl`, `isCustom`.
  - `ownerId` (nullable FK→User Cascade) + `isCustom`: built-ins are `ownerId=null, isCustom=false`; user customs are `ownerId=userId, isCustom=true`.
  - **Soft-delete** via `deletedAt` (nullable). Used for user customs so existing SetLog history isn't orphaned.
  - `loadType` decides what the set row renders for load: `'weight'` shows the numeric stepper (default), `'band'` swaps to a chip picker of the user's Bands, `'none'` drops the load column entirely. Drives SMR / mobility / banded activation work logging the right thing.
  - Indices: (ownerId), (module). Unique (ownerId, name) — Postgres NULL semantics let two `null` owners coexist with same name.
- **ExerciseUserSettings** — per-user per-exercise overrides for `restTimerSeconds` and `weightIncrement`. Unique (userId, exerciseId), both Cascade.

### Sessions and sets

- **WorkoutSession** — `userId` Cascade, `date`, `completedAt` (nullable). Optional `startedFromRoutineDayId` (FK→RoutineDay, **SetNull** so deleting the day doesn't lose history). Indices on (userId, date), (userId, completedAt), (startedFromRoutineDayId).
  - **Invariant: at most one active (`completedAt = null`) session per user.** Enforced by app, not DB.
- **SetLog** — `sessionId` Cascade, `exerciseId` **Restrict** (deliberate — protects history when an exercise soft-deletes), `setNumber` (contiguous per exercise within session), `position` (orders exercises within session), `reps`, `weight`, `seconds`, `bandId` (nullable FK→Band, SetNull), `notes`.
  - `weight` and `bandId` are mutually exclusive in normal use, gated by the source exercise's `loadType`. `updateSet` clears `weight` when a `bandId` is set so the two never both populate.

### Volume and prefs

- **UserVolumeTarget** — per-user per-muscle override. `muscleId` is a string matching `MUSCLE_GROUPS[].id`, **no FK** (muscle list is in code, not DB). Unique (userId, muscleId).
- **UserPreferences** — one per user, lazily created. `restTimerEnabled`, `restTimerSeconds` (default 90), `restTimerSound`, `restTimerVibrate`, `defaultSetsPerExercise` (default 3), `defaultWeightIncrement` (default 5).
- **Band** — per-user resistance-band list (id, userId, name, position). Drives the chip picker for exercises with `loadType='band'`. Lazily seeded with Light/Medium/Heavy on first read by `getUserBands`. Unique (userId, name) and (userId, position). `SetLog.bandId` is SetNull so history survives a band delete.

### Templates and routines

- **WorkoutTemplate** — `userId` nullable + `isBuiltin` bool. Built-ins: `userId=null, isBuiltin=true`. User templates: `userId=set, isBuiltin=false`. Unique (userId, name) — same NULL trick as exercises.
- **UserHiddenTemplate** — per-user marker that the user has hidden a built-in template. Unique (userId, templateId), both Cascade.
- **TemplateExercise** — junction. `position`, `poolId` (nullable — non-null = pool member), `plannedSets`, `plannedReps` (used when exercise.metric='reps'), `plannedSeconds` (used when metric='time'), `plannedWeight`, free-text `note` (per-(day, exercise) cues — tempo, breathing, coach annotations). Unique (templateId, exerciseId).
- **TemplatePool** — "pick X of N" group on a template. `pickCount`, optional `label`; members are `TemplateExercise` rows pointing back via `poolId` (kept as a contiguous `position` run). `startFromRoutineDay` takes `poolPicks` to resolve them at session start.
- **Routine** — one per user (`userId` is `@unique`). `scheduleStyle` `'sequence' | 'weekday'`. `lastCompletedPosition` cursor for sequence mode. App-enforced cap of `MAX_ROUTINE_DAYS = 7`.
- **RoutineDay** — `position` (contiguous), `weekday` (nullable, unique within routine for weekday mode), `label` (short tag), `description` (free-text paragraph framing the day). Unique (routineId, position) and (routineId, weekday).
- **RoutineDayPendingSwap** — staged one-time exercise substitution applied on session start. Unique (routineDayId, outExerciseId). All FKs Cascade.

### Routine sharing and notifications

- **RoutineShare** — owner-minted token-based share link. Cascade from `Routine`. `token` is the URL-visible secret; `revokedAt` is a soft-revoke.
- **ShareReviewer** — anonymous reviewer identity per share, keyed by an HttpOnly cookie. Display name is reviewer-chosen. Unique (shareId, reviewerKey).
- **ShareComment** — polymorphic free-text comment (`targetType` discriminates routine / day / template_exercise / suggestion). No FK on the target — validation lives in the action layer.
- **ShareSuggestion** — polymorphic structured suggestion. `kind` discriminates the `payload Json`; `state` cycles open → applied / rejected / resolved. Validated by `SuggestionPayloadSchema` in `lib/actions.ts`.
- **ShareReaction** — toggle thumbs-up per (reviewer, target, kind). Unique constraint makes the action a clean toggle.
- **Notification** — generic in-app inbox for the routine owner. Loose source refs (no FKs) so deleting the source doesn't take the unread notification with it.

See [`docs/data-model.md`](data-model.md) for relationships and [decisions.md](decisions.md) (`Routine sharing — anonymous public reviewers`) for the framing.

---

## 2. Seeded data (`prisma/seed.ts`, `lib/exercises-data.ts`)

### MUSCLE_GROUPS

Compile-time data in `lib/exercises-data.ts`. Five categories: `lower`, `upper`, `trunk`, `mobility`, `other`. Each entry has an `id` (string key, used by `Exercise.primaryMuscles`/`secondaryMuscles[]` and `UserVolumeTarget.muscleId`), a label, a category, an optional `weeklyVolumeTarget`, and a description. Mobility and "other" entries are recency-only (no volume target). User overrides go in `UserVolumeTarget`; otherwise the compile-time defaults win.

### EXERCISE_MODULES

Ordered list of module tags used to group exercises in the picker. The ordering is the intended workout flow: SMR → Mobility → Activation → Strength → Balance → Rev Up, each section broken down by body region where applicable. The order is meaningful — read the array in `lib/exercises-data.ts` for the canonical sequence. Each module has a one-line description in `MODULE_INFO`.

### Seeded exercises

Authored as `EXERCISES` in `lib/exercises-data.ts`. Most exercises are `metric: 'reps'`; isometric holds, carries, and conditioning movements are `metric: 'time'`. The seed upserts built-ins by `(ownerId=null, name)`. `KNOWN_EQUIPMENT` is a compile-time tuple in the same file — read it directly for the current set.

### Seed idempotence

`npm run db:seed` upserts built-ins by `(ownerId=null, name)` and clears `deletedAt` on previously soft-deleted built-ins. Customs untouched. Safe to re-run any time.

### Starter routines

Live in `lib/starter-routines.ts`. Four focuses — Strength, Build, Mobility, Longevity — each × 1–7 days/cycle × 15/30/45/60 min/day × equipment tier. Each focus assembles day templates from seven slot helpers (squat / hinge / push / pull / vPush / vPull / lunge etc.) plus support slots (mobility / SMR / core / carry / conditioning / thoracic / balance). The user picks one as a starting draft; everything is editable after.

---

## 3. Server actions (`lib/actions.ts`)

All mutations go through here. Every action is wrapped with `withLogging('actionName', ...)` for timing + metrics + error categorization, calls `requireUser()`, Zod-validates inputs at the boundary, scopes DB writes by `userId`, and calls `revalidatePath` after mutating. Expected user-facing errors are thrown as plain `Error('message')` matching `EXPECTED_MESSAGES` in `lib/observability.ts` so they log at warn (not error).

Actions return nothing — the UI reads fresh data via queries on the page revalidation.

The action surface is organized by `// =====` section headers in the file: session lifecycle, set logging, custom exercises, volume targets, user preferences, bands, per-exercise settings, set notes, workout templates, routines (the largest section), and routine startup. To enumerate them, `grep -n '^export ' lib/actions.ts` — the code is the canonical list. See [api.md](api.md) for the conventions, the recipe for adding one, and what `withLogging` instruments for free.

---

## 4. Queries (`lib/queries.ts`)

Server-side only — never import into client components. Some are wrapped with `cache()` for request-scoped dedup (most prominently `getUserPreferences`, called from both the layout and pages).

What's load-bearing about the query surface, rather than the list itself:

- **Recency windows are baked into the queries.** Coverage looks at trailing 90 days; the "last sets" lookup at trailing 180; weekly volume at 7. Tuned to the UI's gradient and to bound memory growth. See [decisions.md](decisions.md).
- **Weighted credit for multi-muscle exercises.** Volume credits primary muscles at 1.0 and secondary at 0.5; coverage (recency) treats both equally. See [decisions.md](decisions.md).
- **Templates currently used by the routine are excluded from `getTemplates`** — they surface through the routine timeline instead. If you write a new template-listing query, decide whether you want the same filter.
- **`getUserPreferences` returns `PREFS_DEFAULTS` when no row exists**, so reads are cheap on every render and writes are lazy. The lazy-row pattern would extend to any future "one row per user" preference table.

For canonical signatures, read `lib/queries.ts` directly — they're terse and the file is well-organized.

---

## 5. Routes (`app/`)

### Layout structure

- `app/layout.tsx` — root HTML shell, fonts (Fraunces / Bricolage Grotesque / JetBrains Mono via `next/font/google`), PWA manifest.
- `app/error.tsx` — root error boundary.
- `app/global-error.tsx` — last-resort boundary for root layout failures.
- `middleware.ts` — auth gate; explicitly excludes `api/auth`, `api/healthz`, `api/metrics`, `api/log/*`.

### `app/(auth)/` — unauthenticated

- `signin/page.tsx` — Google button + magic-link form.
- `verify-request/page.tsx` — "magic link sent" confirmation.
- `error.tsx` — auth-scoped boundary.

### `app/(app)/` — authenticated (gated by middleware)

- `layout.tsx` — app shell (navbar, `PrefsProvider`, cue toggle, notifications bell).
- `page.tsx` — workout view (the main UI). Loads active session, exercises, templates, routine, recent sessions.
- `coverage/page.tsx` — coverage view.
- `routine/page.tsx` — routine editor / timeline.
- `routine/shares/page.tsx`, `routine/shares/[shareId]/page.tsx` — owner-side share inbox and per-share detail view for comments, suggestions, and reactions.
- `notifications/page.tsx` — in-app inbox of share-related notifications.
- `settings/page.tsx` — preferences, volume targets, hidden templates, routine edit.
- `error.tsx` — app-scoped boundary.

### `app/share/[token]/` — public reviewer surface (no auth)

- `page.tsx` — anonymous reviewer view of a shared routine. The only public app route besides `/signin` and `/verify-request`; bypassed in middleware via `PUBLIC_PATHS`. See [decisions.md](decisions.md) (`Routine sharing — anonymous public reviewers`).

### `app/api/` — see [`app/api/CLAUDE.md`](../app/api/CLAUDE.md)

- `auth/[...nextauth]/route.ts` — Auth.js handler. Don't add things here.
- `auth/recover/route.ts` — clears the stale session-token cookie and 302s to `/signin`. See [decisions.md](decisions.md) (`Stale-cookie recovery`).
- `healthz/route.ts` — `SELECT 1` check; 200 or 503. Used by Docker HEALTHCHECK.
- `metrics/route.ts` — Prometheus scrape; gated by `METRICS_TOKEN` Bearer header.
- `log/client-error/route.ts` — browser error sink; rate-limited per IP.

### Service worker / PWA

- `app/manifest.ts`, `app/sw.ts` (Serwist-compiled), `app/offline/page.tsx` — offline fallback. `app/offline/auto-reload.tsx` is a client island that reloads the user's intended destination once `navigator` reports `online` again.
- **SW message protocol.** The SW handles two client-sent messages: `{ type: 'SKIP_WAITING' }` (drives the prompt-and-reload update flow — see [decisions.md](decisions.md) `Service-worker updates use prompt-and-reload`) and `{ type: 'CLEAR_USER_CACHES' }` (drops caches matching `pages|rsc|apis|cross-origin|others` on signout; static-asset caches stay). Mounted client components: `components/ui/sw-update-prompt.tsx` (root-layout-mounted, listens for `updatefound`) and `components/auth/sw-signout-cleanup.tsx` (signin-page-mounted when `?cleanup=1`, posted by both the signout button and `/api/auth/recover`).
- **Touch input zoom.** Pinch-zoom is intentionally enabled at the viewport level; iOS Safari's focus-zoom is suppressed by a 16px floor on form inputs under `@media (pointer: coarse)` in `app/globals.css`. See [decisions.md](decisions.md) `Touch inputs use a 16px font-size floor`.

---

## 6. Workout UI (`components/workout/`)

Has its own [CLAUDE.md](../components/workout/CLAUDE.md). Key shape:

- **`workout-view.tsx`** (top-level client) — owns active-session render, picker open state, save-template dialog, rest timer instance.
- **`exercise-in-session.tsx`** — one card per exercise: header, prescription, last-time reference, set rows, inline rest-timer override.
- **`exercise-picker.tsx`** — bottom-sheet on mobile / centered modal on desktop. Two tabs (Browse, Add custom) + a `swap` mode that single-selects and commits instantly. Browse has region/muscle/equipment chips plus a collapsible module filter; an optional `usageStats` prop adds per-row recency/count hints.
- **`routines/pool-pick-dialog.tsx`** — shown when starting a routine day that has pools; the user picks `pickCount` members per pool, recency-assisted.
- **`rest-timer.tsx`** — `useRestTimer()` hook + `RestTimerBar` UI. **Absolute-deadline pattern** (`endsAt: ms`) so backgrounded tabs don't drift. Singleton AudioContext for chime — don't create per call.

Patterns to know:

- Prefs come from `usePrefs()` context, not props. Prop-drilling them caused a bug — see workout/CLAUDE.md.
- SetRow: local string state, commit on blur, sync only when not focused — keeps inputs responsive.
- Rest timer auto-starts when reps are committed, gated on `prefs.restTimerEnabled`.
- "Saved" green check fades after ~1.2s.

---

## 7. Coverage view (`components/coverage/`)

Renders a color-graded grid of muscle groups, sectioned by category (Lower / Upper / Core / Mobility / Other).

**Recency tiers** (days since most recent set hitting that muscle, primary or secondary):

- ≤2: fresh (bright green)
- ≤4: recent (muted green)
- ≤7: stale (muted orange)
- \>7: neglected (red)
- never: dark gray

**Volume bar** is `getWeeklyVolume` vs. effective target (`UserVolumeTarget` if set, else `MUSCLE_GROUPS` default). Override indicator shows when user-customized.

---

## 8. Settings (`components/settings/`)

Editors for: rest timer (enabled, seconds, sound, vibrate); set seeding (`defaultSetsPerExercise`); weight stepper (`defaultWeightIncrement`); per-muscle volume targets; resistance bands (add/rename/reorder/delete the chip-picker entries that show on `loadType='band'` exercises); unhide hidden built-in templates; routine create/edit/delete.

All writes go through `updateUserPreferences` / `setVolumeTarget` / `resetVolumeTarget`. Reads go through `getUserPreferences` (cached).

---

## 9. Auth (`auth.ts`, `auth.config.ts`, `middleware.ts`)

- **Providers**: Google OAuth + Resend magic links.
- **`allowDangerousEmailAccountLinking: true`** is set on Google — safe here because Google-verified emails + Resend ownership proof remove the impersonation vector. Justified in [decisions.md](decisions.md).
- **Session strategy**: JWT, `maxAge` = 1 year, `updateAge` = 1 day. Fitness tracker, not banking — see decisions.md.
- **`requireUser()`** is called at the start of every action; throws `'Unauthorized'` when no session, which `lib/observability.ts` recognises as expected.
- **Middleware** redirects unauthenticated users to `/signin` and bounces authenticated users away from `/signin`.

---

## 10. Observability and infra

### Logger (`lib/logger.ts`)

Pino, structured JSON to stdout. Auto-redacts `email`, `token`, `password`, `authorization`, `cookie` (and nested forms).

### Metrics (`lib/metrics.ts`)

prom-client registry, reused via `globalThis` across hot reloads.

- **Histograms**: `action_duration_seconds[action, status]`, `db_query_duration_seconds[operation]`.
- **Counters**: `actions_total[action, status]`, `auth_events_total[event, provider]`, `sessions_completed_total`, `sets_logged_total`, `templates_used_total`, `client_errors_total[kind]`.

### Rate limiting (`lib/rate-limit.ts`)

Token-bucket, **in-memory** (fine for self-host; resets on container restart).

- `magicLinkPerIp`: 10 burst, 10/hour.
- `magicLinkPerEmail`: 3 burst, 3/hour.
- `clientErrorPerIp`: 30 burst, 60/hour.

### Health check (`app/api/healthz`)

Runs `SELECT 1`. Returns 200 or 503. Docker HEALTHCHECK polls every 30s; 3 consecutive failures triggers a restart.

### Error boundaries

- `app/error.tsx` — top-level fallback; recognises `'Unauthorized'` for "session expired" UX.
- `app/(app)/error.tsx` — authenticated app routes.
- `app/(auth)/error.tsx` — auth routes.
- `app/global-error.tsx` — root layout failures.

All boundaries call `useReportError(error, source)` to ship to `/api/log/client-error`. No others by design — boundaries that just `console.error` are not added.

### `withLogging` (`lib/observability.ts`)

Wraps every server action. On success: timing + metrics + debug log (warn if >1s). On error: distinguishes expected (matched by `EXPECTED_ERROR_NAMES` and `EXPECTED_MESSAGES`) from bugs (full stack trace).

---

## 11. Build and deploy

### npm scripts (`package.json`)

`dev`, `dev:pretty`, `build` (`prisma generate && next build`), `start`, `lint`, `typecheck`, `db:generate`, `db:migrate`, `db:deploy`, `db:seed`, `db:studio`.

### Dockerfile

Multi-stage, three stages:

1. `deps` — `node:22-alpine` + full `npm ci`.
2. `builder` — `prisma generate`, esbuild-bundle `prisma/seed.ts` to `seed.js` (`--bundle --format=esm --packages=external`), `next build` (standalone output).
3. `runner` — `node:22-alpine`, non-root user, copies standalone + static + prod deps + Prisma artefacts. ENTRYPOINT runs `prisma migrate deploy` then `node server.js`. HEALTHCHECK is `node healthcheck.cjs`.

### docker-compose.yml

Three services on an internal bridge:

- **db**: postgres:16-alpine, persistent `postgres-data` volume, `pg_isready` healthcheck.
- **app**: built from Dockerfile. Publishes 3000:3000. Depends on db (healthy). Env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, provider keys, `LOG_LEVEL`, `METRICS_TOKEN`, `NODE_ENV=production`.
- **backup**: postgres:16-alpine running `backup-loop.sh`. Env: `BACKUP_SCHEDULE_HOUR` (default 03 UTC), `BACKUP_KEEP_LOCAL` (default 7). Mounts `BACKUP_HOST_DIR` → `/backups`.

JSON-file log driver, 10MB × 5 with gzip per service.

### Backup scripts (`scripts/`) — has its own [CLAUDE.md](../scripts/CLAUDE.md)

- `backup.sh` — `pg_dump | gzip -9` to `/backups/<dbname>-<ISO-timestamp>.sql.gz`. Atomic write (`.partial` rename). Prunes to `BACKUP_KEEP_LOCAL` newest. **No encryption** — operator's offsite pipeline handles that.
- `backup-loop.sh` — POSIX sh; runs once on start, then sleeps until next `BACKUP_SCHEDULE_HOUR`.
- `generate-secrets.sh` — outputs `AUTH_SECRET`, `POSTGRES_PASSWORD`, `METRICS_TOKEN`.
- `restore.sh` — manual host-side helper; confirms 'restore', drops public schema, pipes dump in.

---

## 12. Subdirectory CLAUDE.md cheat sheet

Read these when working in the matching directory.

- **[`prisma/CLAUDE.md`](../prisma/CLAUDE.md)** — single-init migration policy (schema changes squash back into one init; data is disposable), built-in vs custom split, soft-delete + Restrict pattern, Prisma 7 layout (client at `prisma/generated/prisma/client`), driver adapter, seed idempotence, schema invariants.
- **[`app/api/CLAUDE.md`](../app/api/CLAUDE.md)** — middleware matcher gotcha (excluded paths), rate-limit-before-body-parse, authenticated vs unauthenticated endpoints, reverse-proxy IP visibility + Caddy snippet for internal endpoints.
- **[`components/workout/CLAUDE.md`](../components/workout/CLAUDE.md)** — component tree, prefs-from-context (not props), SetRow commit semantics, rest timer absolute-deadline design, AudioContext singleton, picker modes, muscle-chip taxonomy.
- **[`scripts/CLAUDE.md`](../scripts/CLAUDE.md)** — POSIX sh constraints (busybox ash, no bash-isms), atomic writes, pruning logic, schedule math.

---

## 13. Notable utilities

- **`lib/utils.ts`** — `daysBetween`, `relativeDay` ("today", "1d ago"…), `groupBy`.
- **`lib/prefs.ts`** — `UserPrefs` type and `PREFS_DEFAULTS` (single source of truth, referenced by schema/queries/actions/context).
- **`lib/routine.ts`**, **`lib/routine-coverage.ts`** — `pickTodaysRoutineDay`, `pickUpcomingRoutineDays`, `isScheduleStyle`; coverage helpers for routine view.
- **`lib/prescription.ts`** — parses "3×12" out of an exercise's prescription string to extract default set count.
- **`lib/starter-routines.ts`** — Strength / Build / Mobility / Longevity preset families used in the routine empty state.
- **`lib/area-filter.ts`** — region (Upper/Lower/Full/Mobility) and muscle chip taxonomy + `balanceHint()`. Used by picker filters and empty-state suggestions.
- **`lib/db.ts`** — Prisma client singleton with `@prisma/adapter-pg` (PrismaPg) adapter. Slow-query logging (>100ms hits stderr). Histogram observation per query.
- **`lib/env.ts`** — boot-time env validation, called from `instrumentation.ts`.
- **Hooks**: `useRestTimer()` (absolute-deadline), `usePrefs()` (context read/update in `components/ui/prefs-context.tsx`), `useReportError()` (`components/ui/use-report-error.tsx`).

Zod schemas live inline in `lib/actions.ts` next to the action that uses them.

---

## 14. Surprises worth flagging

1. **JWT sessions, 1-year lifetime.** Appropriate for a fitness tracker — see [decisions.md](decisions.md). Don't shorten without a reason.
2. **At-most-one active session per user is app-enforced, not DB-enforced.** Pragma. Don't add a partial unique index unless there's a reason.
3. **`SetLog.exerciseId` uses `Restrict`, not `Cascade`.** Deliberate — soft-deleting an Exercise must not orphan its history.
4. **Muscle IDs are strings, not an enum, no FK.** Lets custom exercises reference anything; coverage fails open on unknowns.
5. **Templates in a routine don't cascade with the routine.** The template can outlive a routine day reference.
6. **Absolute-deadline rest timer.** `endsAt: ms` rather than tick-down `seconds-remaining` — browsers throttle backgrounded `setInterval`, drift would be a bug.
7. **One AudioContext shared across rest-timer chimes.** Browsers cap ~6 contexts per origin; per-call construction would exhaust and break audio.
8. **`PrefsContext` is the only context provider.** Everything else is server-rendered + revalidation. Don't reach for Redux/Zustand.
9. **No analytics, no Sentry-style error tracking.** `/api/log/client-error` + Pino is the entire pipeline.
10. **Solo dev, disposable data, permanently.** See the project status section in CLAUDE.md before suggesting back-compat shims, staged rollouts, or migration glue. This isn't a "for now" — it's the project stance.

---

## When to update this doc

Update inline as part of the change that would otherwise make this doc wrong. Concretely:

- A schema change lands (models added/removed, fields renamed, FK behavior changed).
- A new top-level route or major component subtree is added.
- Auth, observability, or deployment shape changes (new provider, new metrics, new docker service).
- You notice a claim that's no longer true — fix it now, even if you weren't planning to.

Prefer narrow edits to the affected sections over rewriting the whole file.
