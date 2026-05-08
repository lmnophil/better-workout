# components/workout/CLAUDE.md

The active workout UI. The most complex part of the frontend — the rest of the app is comparatively static. Read root `CLAUDE.md` first.

## Component tree

- `workout-view.tsx` — the top-level client component. Owns the active session render, the picker open state, the save-template dialog, the rest timer instance. Big file (~600 lines) but linear.
- `exercise-in-session.tsx` — one card per exercise in the active session: header, prescription, last-time reference, set rows, inline rest-timer override editor.
- `exercise-picker.tsx` — bottom-sheet (mobile) / centered modal (desktop). Two tabs: browse + add custom.
- `rest-timer.tsx` — `useRestTimer` hook + `RestTimerBar` UI. Absolute-deadline pattern (see below).

## Prefs come from context, not props

`workout-view.tsx` and the cue-toggle in the layout header both consume the same prefs state via `usePrefs()` from `components/ui/prefs-context.tsx`. If you reintroduce a `preferences` prop on `WorkoutView`, you've recreated the bug the audit fixed (see `docs/decisions.md` for the gory details if you want them).

The contract:
- Read prefs: `const { prefs } = usePrefs()`
- Update prefs: `updatePrefs({ restTimerSeconds: 120 })` — patches the local state and persists via `updateUserPreferences` server action in one call.
- The settings page's `RestTimerEditor` uses the same context. Toggle in any of the three (workout view, cue toggle, settings) and all three update.

If you need a new pref, add it to:
1. `prisma/schema.prisma` (`UserPreferences` model)
2. `lib/queries.ts` (`getUserPreferences` defaults)
3. `lib/actions.ts` (`UpdatePreferencesSchema`)
4. `components/workout/rest-timer.tsx` (`RestTimerPrefs` type) — yes, the type lives here for now

That's a lot of touch points; if it grows further consider extracting the pref shape to a single source.

## Set commit semantics

`SetRow` is the deceptively-tricky part. The contract:

- **Local string state** for `reps` and `weight` so the input is responsive and allows empty (vs. forcing `0`).
- **Commit on blur** — when the input loses focus, parse, compare to props, fire `onUpdate` if changed.
- **Sync from props only when not focused** — so a server revalidation doesn't yank text out from under a typing user.
- **Optimistic "saved" indicator** — green check appears immediately on commit, fades after 1.2s. Cleaned up via ref on unmount.

This pattern shows up three times in `SetRow`: reps, weight, and notes. They're parallel; if you change one, change the others to match.

**Auto-start the rest timer** happens in `workout-view.handleUpdateSet`, NOT in `SetRow`. The trigger is "reps committed to a non-null positive value AND prefs.restTimerEnabled." Don't move this logic — it needs the prefs and the per-exercise rest override which `SetRow` doesn't have.

## Rest timer: absolute deadline, not tick-down

`useRestTimer` tracks `endsAt: number | null` (ms timestamp), not "seconds remaining." This is deliberate:

- Tab backgrounding doesn't drift the timer (browsers throttle setInterval in inactive tabs).
- Laptop sleep doesn't desynchronize.
- Works even if React re-renders are sparse.

The displayed "now" updates every 250ms while a timer is active; calculations are `Math.max(0, Math.ceil((endsAt - now) / 1000))`. If you find yourself wanting to add `setSecondsRemaining`, you're working against the design — don't.

The `finishedFor` ref makes the chime fire exactly once per timer run, even across re-renders. Don't remove it.

## AudioContext: shared singleton

`playChime` reuses a module-level `sharedAudioCtx`. Browsers cap concurrent contexts (~6); creating one per chime exhausted the limit during longer workouts and the chime would silently stop working. If you touch this code:

- Don't go back to `new AudioContext()` per call.
- Don't call `ctx.close()` in normal flow — keep it alive for the page's lifetime.
- The `state === 'suspended'` resume call handles browsers that suspend without a user gesture.

## Picker conventions

The picker's two tabs (browse / add-custom) share an enclosing modal but have nothing else in common. They could be split into separate files; they're not, because the file is short enough and the boundary is clear.

The browse tab's search matches name OR primary muscle OR secondary muscle, case-insensitive. If you add another searchable field to `Exercise`, update the filter.

The custom-add tab enforces `primary muscles >= 1`. The Zod schema in `createCustomExercise` enforces the same. These need to match.

## Templates

Save-from-active and start-from-template are fully implemented. There's no dedicated `/templates` management page yet — deletion happens inline in the empty-state list. If you add `/templates`, the data model already supports it (see `prisma/schema.prisma`); just write the page.

`SaveTemplateDialog` does NOT close optimistically — it awaits the action and surfaces collision errors inline. If you change this to optimistic, you've reintroduced a bug the audit fixed.

## Things you might want to do that would be wrong

- **Reintroducing prop-drilled prefs.** Use the context.
- **`setInterval` with seconds-remaining state in the rest timer.** Use the absolute-deadline pattern.
- **Creating a fresh AudioContext per chime.** Reuse the singleton.
- **Treating `setNumber` as authoritative for ordering across exercises.** It's per-`(session, exercise)`, contiguous from 1. Cross-exercise ordering is `position`. Don't mix them.
- **Optimistically closing dialogs before action resolution.** Async flow with proper error surface, every time.
- **Adding "today's plan" UI.** See root CLAUDE.md — sessions are records, not plans.
