# API reference

This is the API surface of the workout tracker. It's a guidebook, not exhaustive reference — for parameter shapes and return types, the source is the truth. Each section points you at the file where the canonical signature lives.

## Three surfaces

The app has three distinct ways of being called, and they answer different questions.

**Server actions** (`lib/actions.ts`). The application API. Every state change goes through here, organized into the categories below. Called directly from React components — Next.js handles the wire format. When someone says "the API," this is usually what they mean.

**Server-side queries** (`lib/queries.ts`). Reads, called only from server components. Never called from a browser; never wrapped in HTTP handlers.

**HTTP routes** (`app/api/*`). System-level endpoints — auth handler, health check, metrics scrape, error sink. None of them are how the app does its actual work; they exist because something outside React needs to talk to the app (Docker, Prometheus, the browser's error boundary).

**Default to server actions.** When you're adding "the user can do X," the answer is almost always a new action in `lib/actions.ts`. Reach for an HTTP route only when there's a specific reason it can't be a server action — typically: it must be unauthenticated, it must return a non-HTML format, or it's called by something other than the React app.

## How to call a server action from the React side

The canonical pattern, used throughout `components/workout/`:

```tsx
'use client';
import { useTransition } from 'react';
import { addSet } from '@/lib/actions';

function AddSetButton({ exerciseId }: { exerciseId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() => startTransition(() => addSet({ exerciseId }))}
    >
      Add set
    </button>
  );
}
```

`useTransition` gives you `isPending` to disable the button during the call (preventing double-submits) and lets the action run without blocking the UI thread. If the action throws, the error bubbles to the nearest `error.tsx` boundary — you don't need a `try/catch` for routine error handling.

## How to read a server action

Here's an annotated example from `lib/actions.ts`:

```ts
const AddSetSchema = z.object({ exerciseId: z.string().min(1) });

export const addSet = withLogging('addSet', async (input: z.infer<typeof AddSetSchema>) => {
  const userId = await requireUser();                // 1. auth
  const { exerciseId } = AddSetSchema.parse(input);  // 2. validation
  await requireAvailableExercise(userId, exerciseId);// 3. ownership check
  const session = await findActiveSession(userId);
  if (!session) throw new Error('No active session');// 4. expected error
  // ... mutation logic ...
  metrics.setsLogged.inc();                          // 5. domain metric
  revalidatePath('/');                               // 6. invalidate
});
```

What each piece is doing:

1. **`requireUser()`** — pulls userId from the Auth.js session. Throws `'Unauthorized'` if there isn't one. Never trust a userId from the client; always derive it server-side.
2. **Zod parse** — validates inputs at the trust boundary. Throws on bad shape; the `withLogging` wrapper categorizes Zod errors as expected (warn level).
3. **Ownership check** — before mutating anything that has an owner, verify the current user owns it. `requireAvailableExercise` covers the "is this exercise mine or built-in" case; for sets, it's the `setLog.session.userId !== userId` pattern.
4. **Expected errors** — string prefixes that match `EXPECTED_MESSAGES` in `lib/observability.ts` log at warn (no stack trace). New error messages need to be added there or they'll be logged as bugs.
5. **Domain metrics** — call out to the Prometheus counter when something user-meaningful happens (set logged, session completed, template used).
6. **`revalidatePath`** — tells Next.js the page's cached server-component output is stale, so the next render fetches fresh data. Every mutation needs this; without it the user sees their old data after a successful action.

The `withLogging('addSet', ...)` wrapper handles timing histograms, success/error counters, slow-action warnings, and expected-vs-bug categorization automatically. Don't add your own action-level logging — let the wrapper do it.

## Auth model in one paragraph

Every server action calls `requireUser()` first; the function throws `'Unauthorized'` if there's no session. Every server-side query takes `userId` as a parameter and is called from a server component that already authed at the top of its `async function Page()` body. The middleware redirects unauthenticated requests away from protected routes before they ever reach the action or query layer — but actions and queries don't trust that, they re-check. Belt and suspenders on purpose.

## Server actions: the categories

Actions in `lib/actions.ts` are grouped by `// =====` section headers in the file. The categories and their shapes — for canonical signatures, `grep -n '^export ' lib/actions.ts`.

**Session lifecycle.** How a user's active session gets created, populated, finished, or thrown away. The user has at most one active session at a time (`completedAt = null`). Adding exercises auto-creates the session; emptying it auto-deletes. Completing requires at least one set; discarding is destructive. Reorders run inside transactions so observers never see two exercises sharing a position.

**Set logging.** The most-frequently-called actions in the app — every rep and weight commit. Adds pre-fill from the previous set (progressive overload is one tap). Updates refuse if the parent session is already completed. Removals renumber the remaining sets so `setNumber` stays contiguous; if the removal leaves the session empty the session itself is deleted.

**Custom exercises.** Per-user customs (`ownerId = userId`) live in the same `Exercise` table as built-ins (`ownerId = null`). Deletes are soft (`deletedAt`), so historical SetLogs aren't orphaned — the `Restrict` FK on `SetLog.exerciseId` enforces this at the DB level too.

**Volume targets, user preferences, per-exercise settings, set notes.** Small upsert-style actions. Preferences are written through `PrefsContext`, not directly. Volume targets are per-(user, muscle); per-exercise settings are per-(user, exercise); set notes are per-`SetLog`. The user-preferences row is lazily created on first write (the query returns `PREFS_DEFAULTS` if missing).

**Workout templates.** Named, reusable lineups. `saveActiveAsTemplate` snapshots exercises + order from the active session — not the logged sets. `startFromTemplate` creates a fresh active session from a template. User templates can be deleted; built-ins can only be hidden via `UserHiddenTemplate` (and unhidden later). The split is enforced at the action layer.

**Routines.** The user's named cycle of templates. One per user, capped at 7 days. Two scheduling modes (`sequence` advances a cursor on completion; `weekday` reads today's `getDay()`). Pending swaps stage a one-time exercise substitution that applies when the session is started from the routine day; permanent swaps edit the underlying `TemplateExercise` and refuse to modify built-in templates. `startFromRoutineDay` populates a session and marks it with `startedFromRoutineDayId`; completing such a session advances the cursor in `sequence` mode. Per-(day, exercise) edits — planned sets/reps/seconds *and* the free-text `note` — flow through `addExerciseToRoutineDay` and `updateRoutineDayExercise`, both of which accept `note` as an optional patch field that trims to null on empty. See [`docs/decisions.md`](./decisions.md) for the routines stance and [`docs/data-model.md`](./data-model.md) for the entities.

## Server-side queries: the categories

Queries in `lib/queries.ts`. All take `userId` as the first parameter; never trust a client-supplied one. Some are `React.cache()`-wrapped (most prominently `getUserPreferences`).

**Active session and exercises.** `getActiveSession` returns the user's in-progress session or null; `getAvailableExercises` returns built-ins + non-deleted customs annotated with the user's per-exercise overrides; `getLastSetsByExercise` returns "what did I do last time" for the trailing 180 days (see [decisions.md](./decisions.md) on the window).

**Coverage and volume.** A `Map<muscleId, Date>` of most-recent muscle hits (trailing 90 days) drives the color-graded coverage map; a `Map<muscleId, number>` of weighted weekly sets drives the volume bars. Primary muscles credit 1.0 per set, secondary 0.5 — coverage (recency) treats both equally.

**Preferences and templates.** `getUserPreferences` returns defaults when no row exists, so first-render is cheap. `getTemplates` returns the user's templates + unhidden built-ins, **excluding templates currently used by the routine** (those surface through the routine timeline). `getHiddenBuiltinTemplates` drives the unhide UI in settings.

**Routines.** `getRoutineForUser` returns the full nested structure (routine → days → template → exercises + pending swaps). `getRoutineRecentSessions` lists completed sessions started from a routine day. Pure-logic helpers in `lib/routine.ts` (`pickTodaysRoutineDay`, `pickUpcomingRoutineDays`) compute the timeline.

## HTTP routes

> Every request not explicitly excluded in `middleware.ts` goes through edge middleware first, which redirects unauthenticated users to `/signin`. The four routes below are all in the matcher's exclusion list — they need to bypass auth-based redirects, either because they're unauthenticated by design or because they handle auth themselves. See `app/api/CLAUDE.md` for the full pattern.

| Route | Method | Auth | Called by | Purpose |
|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | self-managed | Auth.js itself | Auth.js's own callback handler. Don't add anything here. |
| `/api/auth/recover` | GET | none | The (app) layout when `auth()` returns null on a parseable cookie | Clears the session-token cookie variants and 302s to `/signin`. The (app) layout redirects here instead of straight to `/signin` so the stale cookie gets cleared on the way through — without this hop, the cookie would still look valid to middleware (which uses the Edge-safe auth config and can't see DB state), producing a redirect loop. Mostly fires after `prisma migrate reset` in dev. See [`docs/decisions.md`](./decisions.md) (`Stale-cookie recovery`). |
| `/api/healthz` | GET | none | Docker `HEALTHCHECK` | Returns 200 + a tiny JSON body when the app is alive and DB-reachable. Public-facing healthcheck would be lower-trust; this one runs `SELECT 1`. |
| `/api/metrics` | GET | Bearer token | Prometheus scraper | Prometheus exposition format. Returns 503 if `METRICS_TOKEN` env is unset (fail-closed). The reference Caddy snippet 404s it at the public edge — scrape over the internal Docker network or from a same-host scraper. |
| `/api/log/client-error` | POST | none | Browser error boundaries | Sink for client-side crashes (route + global error.tsx). Rate-limited per IP. Logs at error level via Pino. |

There is **no `POST /api/sets`, no `GET /api/exercises`**, etc. Mutations are server actions; reads are server-component queries. If you find yourself wanting an application-data HTTP route, ask why first — almost always the answer is a server action.

## Adding a new server action

The recipe, in order:

1. **Define a Zod schema** for the input. Keep it adjacent to the action, named `<ActionName>Schema`.
2. **Wrap with `withLogging('actionName', async (input) => {...})`**. The string name is what shows up in metrics and logs.
3. **Call `requireUser()`** as the first line. Don't accept `userId` from input.
4. **Validate input** with `Schema.parse(input)`.
5. **Check ownership** of any resource you're touching. For exercises, use `requireAvailableExercise`. For sets, scope by `setLog.session.userId === userId`.
6. **Throw expected errors as `Error` with stable message prefixes.** If you add a new prefix, also add it to `EXPECTED_MESSAGES` in `lib/observability.ts` — otherwise it'll log at error level with a stack trace, polluting the log stream.
7. **Wrap multi-step DB writes in `db.$transaction`.** A failure mid-sequence shouldn't leave the database half-mutated.
8. **Bump a domain metric** if the action represents something user-meaningful (`metrics.setsLogged.inc()`, etc.). Pure infrastructure actions don't need this.
9. **`revalidatePath('/')`** at the end (or the relevant path). Without it the user sees stale data.

The `withLogging` wrapper handles timing, success/error counts, and slow-action warnings — don't add per-action `logger.info` calls. Let the wrapper instrument.

## Adding a new HTTP route

Rare, but when it happens:

1. **Update the middleware matcher in `middleware.ts`** to exclude the route from auth redirects (if it's public) or include it (if it's authenticated and you want middleware to handle the redirect).
2. **Apply rate limiting** if the route is unauthenticated. Reuse a limiter from `lib/rate-limit.ts` or add a new one.
3. **Set `dynamic = 'force-dynamic'`** if the route should never be cached.
4. **Use `NextResponse` for all responses.** Set explicit status codes — see `app/api/CLAUDE.md` for the conventions.
5. **Don't put business logic in the route.** Routes are thin — parse input, validate, call into `lib/`, format response.

## What gets logged automatically

When you wrap an action with `withLogging`, you get for free:

- **Timing histogram** (`action_duration_seconds{action,status}`) — Prometheus metric.
- **Counter** (`actions_total{action,status}`) — for rate dashboards.
- **Slow-action warning** at log level `warn` if the action takes >1s.
- **Error categorization** — expected errors (matched against `EXPECTED_MESSAGES` or known error names like `ZodError`) log at `warn`; everything else logs at `error` with a full stack.
- **Action name in the log context** via `logger.child({ action: name })` — every log line during the action is tagged.

Prisma queries are also auto-instrumented via `lib/db.ts`'s `$on('query')` hook: timing histogram for every query, plus a `warn` log for anything over 100ms with the parameterized SQL (no values — those would leak PII). Auth events (sign-in, sign-out, user-created, account-linked) are instrumented via Auth.js's `events` config in `auth.ts`.

You almost never need to add your own logging or metrics inside an action. If you do, use the `logger` from `@/lib/logger` (with `.child({...})` for context) and `metrics` from `@/lib/metrics`.
