# Package 1: Expected-error transport that survives production

Read [README.md](README.md) in this directory first for how to use this brief. Line numbers are
as of commit `94365db` — re-locate by symbol.

## The problem

The app's error convention is: expected user-facing failures are thrown as `Error` with stable
message prefixes (matched against `EXPECTED_MESSAGES` in `lib/observability.ts`), and the client
either renders `err.message` inline or lets it bubble to an `error.tsx` boundary.

**This convention is broken in production builds.** Next.js redacts the `message` of any `Error`
thrown from a server action or server component in prod — the client receives a generic string
plus a `digest`. Consequences, all invisible in `next dev`:

- Every inline error renderer shows Next's generic message instead of the real one:
  `components/share/reviewer-gate.tsx:32`, `components/routines/routine-timeline.tsx:338,406`,
  `components/routines/routine-editor.tsx:712`, `components/workout/workout-view.tsx:963`,
  `components/share/share-view.tsx:814`.
- `app/(app)/error.tsx:19` branches on `error.message.toLowerCase().includes('unauthorized')`
  to show "Session expired / Sign in" — dead code in prod, since the message never arrives.
- The carefully-written messages in `lib/actions.ts` (~40 distinct expected errors) are unread
  by the people they were written for, exactly when early testers arrive.

## The task

Design and implement an expected-error transport that survives the prod build, then migrate the
codebase to it. The obvious candidate is returning typed results from actions for _expected_
failures (e.g. `{ ok: false, error: string }` or a discriminated union) while continuing to
throw for unexpected/bug-class errors so they still hit `withLogging`'s bug path and the error
boundary. But you're trusted to pick the design — other serializable conventions exist. Whatever
you choose:

- It must be ergonomic enough that all ~40 expected throws in `lib/actions.ts` can adopt it
  without each call site becoming a ceremony.
- `withLogging` in `lib/observability.ts` must still classify correctly: expected failures log
  at info/warn without stacks; unexpected ones log as bugs. Today classification happens by
  message prefix at throw time — your design may make `EXPECTED_MESSAGES` partly or wholly
  obsolete. If so, delete or shrink it rather than maintaining drift.
- The "Session expired" detection in `(app)/error.tsx` needs a transport that works in prod
  (e.g. the unauthorized case becomes a typed result, or a redirect, or a digest-based check —
  your call).
- The four public share actions and the two share-reviewer delete actions
  (`deleteShareSuggestion`, `deleteShareComment`) follow the same convention — include them.
- Client call sites that render `err.message` need to read the new shape instead. Coordinate
  with Package 2 (client action discipline): if Package 2 hasn't run yet, update the existing
  call sites minimally to read the new shape; Package 2 will do the deeper rework of
  pending/await handling. Note in your summary what you left for it.

## Sub-task: EXPECTED_MESSAGES drift (do this regardless of design)

Mechanically verified at `94365db` — if your design keeps prefix-matching anywhere, fix these:

Thrown but missing from the list (currently log as bugs):

- `'Band not found'` (actions.ts:367, 909, 931, 968)
- `'Band name already in use'` (883, 914)
- `'Only built-in templates can be hidden'` (1355) — the list's `'Built-in templates'` prefix
  doesn't match
- `'Too many similarly-named templates…'` (1421)
- `"A day can't list the same exercise twice."` (1505) — list has stale `"A template can't list"`
- `"That exercise isn't in this day."` (2051) — thrown string is _shorter_ than the list's
  `"That exercise isn't in this day's template"`, so `startsWith` fails
- `"Reorder list doesn't match the day's exercises."` (2250, 2258)
- `'Reorder list has duplicate exercises.'` (2254)
- `'Routine is already at the ${MAX_ROUTINE_DAYS}-day cap.'` (2718) — list only covers
  `'A routine can have at most'`

Stale entries with no matching throw (delete): `'This day uses a default template'`,
`'A pool needs at least'`, `'Two new templates named'`, `"A template can't list"`,
`'Notification not found'`.

Also: `EXPECTED_ERROR_NAMES` lists the legacy Prisma `NotFoundError` — verify Prisma 7 still
throws anything by that name; if not, remove or replace it.

Consider adding a cheap guard against future drift (a script or test that extracts thrown
messages from actions.ts and diffs against the list) — but only if the list survives your
design at all.

## Constraints

- Keep all mutations in `lib/actions.ts` per CLAUDE.md; this package changes _how_ they report
  failure, not where they live.
- Don't weaken the bug-logging path: genuinely unexpected errors must keep full-stack logging
  and reach error boundaries.
- This is a convention change — record it as an ADR in `docs/decisions.md` and update the
  conventions described in `docs/api.md` and the root `CLAUDE.md` so future sessions follow the
  new pattern.

## Verification

- `npm run typecheck && npm run lint`.
- **Test in a production build** (`npm run build && npm start` or the Docker image) — the whole
  point is dev/prod divergence. Trigger at least: a duplicate custom-exercise name, the
  weekday-already-taken error in the routine editor, and a share-reviewer expected error, and
  confirm the real message reaches the UI.
- Confirm via logs that an expected failure logs without a stack and a forced unexpected error
  (temporarily throw somewhere) still logs as a bug and hits the boundary.
