# Package 2: Client action-call discipline

Read [README.md](README.md) first. Line numbers as of `94365db` — re-locate by symbol.
**Run after Package 1** (error transport) — this package is where its results get surfaced.
Read `components/workout/CLAUDE.md`; several of its documented patterns are the model to copy.

## The problem

Client components call server actions in ways that defeat both the pending-state convention and
error handling. Three systemic failures:

### A. Fire-and-forget inside `startTransition`

React 19 only entangles a transition with async work that is **awaited or returned** from the
scope. Most handlers in `components/workout/workout-view.tsx:261-490` (and
`components/ui/prefs-context.tsx:40-45`) use the statement form
`startTransition(() => { action({...}) })`:

- `isPending` flips back almost immediately, so every `disabled={isPending}` guard barely
  engages — the file's own header comment claiming double-submit prevention is not achieved.
- A rejected action becomes an **unhandled promise rejection**: no boundary, no message.
  Offline-in-the-gym is a _normal_ condition for a PWA, and `'You already have a workout in
progress'` from a second tab is an expected error — both currently vanish.
- The inconsistency proves the intent: `handleComplete`/`handleDiscard` (workout-view.tsx:393, 406) use the implicit-return form, which IS tracked.
- `PrefsContext` additionally applies an optimistic local patch with no rollback, so a failed
  pref write desyncs UI from DB until reload.

### B. The custom-exercise creation flow loses user input

- `components/workout/exercise-picker.tsx:1040-1063` — `CustomTab.submit` clears all form state
  synchronously and the picker switches to Browse (:210-214) **before** the action resolves.
- `components/workout/workout-view.tsx:409-427` — `handleCreateCustom` fires
  `createCustomExercise` un-awaited; a name collision (an _expected_ error, actions.ts:732) is
  completely silent: form gone, no exercise, no message.
- `components/routines/routine-editor.tsx:986-1005, 1645-1664` — same flow but awaited with no
  catch, so the collision escalates to the route error boundary: a full-page error for a name
  collision.
- `SaveTemplateDialog` (workout-view.tsx) gets this right — close-on-success-only, inline error,
  Escape guarded while submitting. It's the documented model in `components/workout/CLAUDE.md`.

### C. Swallowed and double-fired errors elsewhere

- `components/routines/routine-editor.tsx:1457-1583` — `onAddDay` (whose comment claims errors
  are "surfaced to console" — nothing is logged), `onRenameDay`, `onSetWeekday`,
  `onUpdateDayDescription`, `onSortDayByModule`, `onDuplicateDay`, `onUpdateExercisePlanned`,
  and all four pool callbacks swallow expected, user-meaningful errors (`'A routine can have at
most…'`, `'That weekday is already taken'`…) with empty `.catch(() => {})`. The user's edit
  silently doesn't stick. `MetaPanel.commitName` (:1768) reverts but says nothing.
- Enter-key submits bypass pending guards (button is disabled, Enter is not) → real
  double-submissions: `components/share/share-view.tsx:735-737` (+ `submit` at :666),
  `components/share/target-thread.tsx:165-167, 73-84`, `components/settings/bands-editor.tsx`
  (`add()` — double-Enter creates two bands), `components/share-owner/shares-index.tsx`
  (`mint()` — double-Enter mints two share links).
- `components/share/share-view.tsx:577-590` — `quickRemove` calls `postShareSuggestion` raw on
  click: no transition, no disabled state; double-tap files duplicate suggestions.
- `components/share/suggestion-builder.tsx:269-287` — `InsertFlow.onPickMany` fire-and-forget
  with `finally { onClose() }`: the dialog closes even when the post failed (silent loss), and
  the "Use N exercises" button is never pending-disabled.
- `components/share/suggestion-builder.tsx:432-435` — `ReorderFlow` calls the parent's
  `setBuilder` during render (`if (!day) { onClose(); return null; }`) — React's "cannot update
  while rendering" violation; move to an effect or guard in the parent.

### D. Prop-sync effects that clobber focused inputs (smaller, same family)

`SetRow` in `exercise-in-session.tsx:487-498` implements the documented pattern: sync from
props only when the input isn't focused. Three later copies dropped the focus check and can
yank text out from under a typing user when a revalidation lands:
`routine-editor.tsx:1753-1758` (MetaPanel name/description — comment claims the guard exists;
code doesn't check), `:2245-2247` (DayCard rename), `:3294-3299` (PlannedInputs sets/reps).

Also one adjacent stale-state bug: the routine-editor draft re-hydration effect
(`routine-editor.tsx:437-458`) depends on `[availableExercises]`, which changes identity on
every `router.refresh()` — re-running it silently drops empty draft days the user just added.
Hydrate once (ref/empty deps), apply the exercise-validity filter only on first load.

## The task

Make action calls trustworthy app-wide: `isPending` spans the real request, expected errors
(using Package 1's transport) surface to the user near where they acted, unexpected ones reach
the boundary, and no flow loses user input on failure. The specific fixes above are the
evidence list, but look for a _systemic_ answer — e.g. a small shared helper/hook that wraps
"run this action in a transition, expose pending, route expected errors to an inline setter" —
so the 30+ call sites converge on one pattern instead of 30 hand-rolled try/catches. You're
trusted to design it; `SaveTemplateDialog` and `SetRow` show the target behavior.

## Constraints

- Per CLAUDE.md: `useTransition` + `isPending` on buttons is the convention; `PrefsContext`
  stays the only context provider.
- Don't regress the optimistic-UI feel of set logging (`SetRow`'s commit-on-blur contract is
  correct today — see `components/workout/CLAUDE.md`).
- If Package 1 hasn't run yet, stop and run it first (or coordinate): surfacing `err.message`
  from throws is pointless in prod.

## Verification

Playwright MCP against the dev server, plus at least one prod-build spot check:

- Create a custom exercise with a duplicate name from both the workout picker and the routine
  editor → inline error, form input preserved.
- Start a workout in two tabs → second tab gets a visible expected error, not silence.
- Double-press Enter on: new band name, share-link label, share comment → exactly one created.
- Set a weekday that's already taken in the routine editor → visible feedback.
- With DevTools offline, log a set → user sees a failure indication, not a green checkmark.
- Type in the routine name field while a previous edit's revalidation lands → text not clobbered.
- `npm run typecheck && npm run lint`.
