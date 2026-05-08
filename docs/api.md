# API reference

This is the API surface of the workout tracker. It's a guidebook, not exhaustive reference — for parameter shapes and return types, the source is the truth. Each section points you at the file where the canonical signature lives.

## Three surfaces

The app has three distinct ways of being called, and they answer different questions.

**Server actions** (`lib/actions.ts`). The application API. Every state change goes through here. Eighteen functions, organized into nine categories below. Called directly from React components — Next.js handles the wire format. When someone says "the API," this is usually what they mean.

**Server-side queries** (`lib/queries.ts`). Reads, called only from server components. Eight functions. Never called from a browser; never wrapped in HTTP handlers.

**HTTP routes** (`app/api/*`). System-level endpoints — auth handler, health check, metrics scrape, error sink. Four routes total. None of them are how the app does its actual work; they exist because something outside React needs to talk to the app (Docker, Prometheus, the browser's error boundary).

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

## Server actions

Eighteen actions in `lib/actions.ts`, grouped into nine categories that match the `// =====` section headers in the file.

### Session lifecycle

How a user's active session gets created, populated, finished, or thrown away.

- **`addExerciseToActiveSession({ exerciseId })`** — Adds an exercise to the active session, creating the session if none exists. No-op if the exercise is already in the session. Pre-fills with one empty set.
- **`removeExerciseFromActiveSession({ exerciseId })`** — Removes all sets for an exercise from the active session. Deletes the session entirely if it had no other exercises.
- **`completeActiveSession()`** — Marks the active session `completedAt: now`. Refuses if the session has zero sets (deletes it instead).
- **`discardActiveSession()`** — Hard-deletes the active session and all its sets. Used when the user wants to throw away an in-progress workout.
- **`reorderExercise({ exerciseId, direction: 'up' | 'down' })`** — Swaps the position of an exercise with its neighbor. Atomic — both updates run in one transaction so observers never see two exercises sharing a position.

### Set logging

The most-frequently-called actions in the app — every rep and weight commit goes through `updateSet`.

- **`addSet({ exerciseId })`** — Adds a new set to an exercise that's already in the active session. Pre-fills reps/weight from the previous set so progressive overload is one tap. Throws `'Exercise not in active session'` if you call it for an exercise the user hasn't added — see `docs/decisions.md` for why we enforce this.
- **`updateSet({ setLogId, reps, weight })`** — Updates a single set's reps and/or weight. Refuses if the parent session is already completed.
- **`removeSet({ setLogId })`** — Deletes a set and renumbers the remaining sets for that exercise so they stay contiguous (1, 2, 3...). Done in one transaction. Cleans up the session if removing this set leaves it empty.

### Custom exercises

Users can add their own exercises beyond the built-in seed list. Custom exercises are scoped to the creating user (`ownerId = userId`); built-ins have `ownerId: null`.

- **`createCustomExercise({ name, primaryMuscles, secondaryMuscles?, prescription?, videoUrl?, restTimerSeconds? })`** — Creates a new custom exercise plus its optional per-exercise rest override, in one transaction. Rejects names that collide with the user's existing customs.
- **`deleteCustomExercise({ exerciseId })`** — Soft-deletes (`deletedAt: now`). Preserves SetLog history that references the exercise. Don't hard-delete; the schema's Restrict on SetLog blocks it anyway.

### Volume targets

Per-user overrides for the "X sets per muscle per week" defaults.

- **`setVolumeTarget({ muscleId, target })`** — Upserts an override. `target` is a non-negative integer.
- **`resetVolumeTarget({ muscleId })`** — Removes the override; the muscle reverts to the default in `MUSCLE_GROUPS`.

### User preferences

Rest timer behavior. The `PrefsContext` in `components/ui/prefs-context.tsx` calls this — components rarely call it directly.

- **`updateUserPreferences({ restTimerEnabled?, restTimerSeconds?, restTimerSound?, restTimerVibrate? })`** — Partial update. Lazily creates the row on first call. Only fields included in the input are changed.

### Per-exercise settings

Currently just rest-timer overrides; the table exists for future per-(user, exercise) settings.

- **`setExerciseRestOverride({ exerciseId, restTimerSeconds })`** — Sets or clears (when `restTimerSeconds` is `null`) the per-exercise rest override. The same row is used for built-ins and customs.

### Set notes

Free-text per-set annotations. Surfaced in the "last time" reference.

- **`updateSetNotes({ setLogId, notes })`** — Empty string clears the note (stored as `null`). Trimmed.

### Workout templates

Named, reusable lineups. Saving captures only the exercises and order — not the logged sets.

- **`saveActiveAsTemplate({ name, description? })`** — Snapshots the active session's exercises into a new named template. Rejects name collisions.
- **`startFromTemplate({ templateId })`** — Creates a fresh active session pre-populated with empty SetLogs from the template. Refuses if the user already has an active session — they must complete or discard the current one first.
- **`deleteTemplate({ templateId })`** — Removes the template. Existing sessions started from it are unaffected.

## Server-side queries

Eight queries in `lib/queries.ts`. All take `userId` as the first parameter; never trust a client-supplied one.

### Active session and exercises

- **`getActiveSession(userId)`** — The user's in-progress session, or `null`. Includes setLogs, ordered by position then setNumber.
- **`getAvailableExercises(userId)`** — Built-ins + the user's customs (excluding soft-deleted). Each row is augmented with `restTimerSecondsOverride` (the per-user setting if any).
- **`getLastSetsByExercise(userId, excludeSessionId?)`** — For each exercise the user has logged in a *completed* session, the sets from the most recent such session. Drives the "last time" display. Capped to the trailing 180 days for performance — see `docs/decisions.md` and `lib/queries.ts` for the rationale.

### Coverage and volume

- **`getCoverageData(userId)`** — A `Map<muscleId, Date>` of when each muscle was most recently worked. Drives the color-graded coverage map. Capped to 90 days (the UI gradient maxes at 7 days neglected, anything older renders identically).
- **`getWeeklyVolume(userId)`** — A `Map<muscleId, number>` of weighted sets per muscle in the trailing 7 days. Primary muscles count 1.0 per set, secondary count 0.5. Rounded to one decimal.
- **`getUserVolumeTargets(userId)`** — A `Map<muscleId, target>` of the user's overrides.

### Preferences and templates

- **`getUserPreferences(userId)`** — The user's prefs, with defaults filled in if no row exists. Wrapped with `React.cache` so multiple callers in one request share a single DB hit.
- **`getTemplates(userId)`** — All saved templates with their exercises in order. Includes a small subset of the exercise relation (id, name, module, deletedAt) for preview rendering.

## HTTP routes

> Every request not explicitly excluded in `middleware.ts` goes through edge middleware first, which redirects unauthenticated users to `/signin`. The four routes below are all in the matcher's exclusion list — they need to bypass auth-based redirects, either because they're unauthenticated by design or because they handle auth themselves. See `app/api/CLAUDE.md` for the full pattern.

| Route | Method | Auth | Called by | Purpose |
|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | self-managed | Auth.js itself | Auth.js's own callback handler. Don't add anything here. |
| `/api/healthz` | GET | none | Docker `HEALTHCHECK` | Returns 200 + a tiny JSON body when the app is alive and DB-reachable. Public-facing healthcheck would be lower-trust; this one runs `SELECT 1`. |
| `/api/metrics` | GET | Bearer token | Prometheus scraper | Prometheus exposition format. Returns 503 if `METRICS_TOKEN` env is unset (fail-closed). Caddy 404s it from the public internet — scrape over the internal Docker network. |
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
