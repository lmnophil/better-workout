# components/workout/CLAUDE.md

The active workout UI. The most complex part of the frontend — the rest of the app is comparatively static. Read root `CLAUDE.md` first; for the file-level component tree see [`docs/codebase-map.md`](../../docs/codebase-map.md) §6. This doc covers the patterns and invariants that the code alone can't show.

## Prefs come from context, not props

`workout-view.tsx` and the cue-toggle in the layout header both consume the same prefs state via `usePrefs()` from `components/ui/prefs-context.tsx`. Don't reintroduce a `preferences` prop on `WorkoutView` — prop-drilling prefs across the layout/page boundary caused state desync between the workout view and the header cue toggle (each held its own copy). See `docs/decisions.md` for the full write-up.

The contract:

- Read prefs: `const { prefs } = usePrefs()`
- Update prefs: `updatePrefs({ restTimerSeconds: 120 })` — patches the local state and persists via `updateUserPreferences` server action in one call.
- The settings page's `RestTimerEditor` uses the same context. Toggle in any of the three (workout view, cue toggle, settings) and all three update.

If you need a new pref, add it to:

1. `prisma/schema.prisma` (`UserPreferences` model)
2. `lib/prefs.ts` (`UserPrefs` type + `PREFS_DEFAULTS`)
3. `lib/queries.ts` (`getUserPreferences` reads the new column)
4. `lib/actions.ts` (`UpdatePreferencesSchema` accepts the new field)

The shared `UserPrefs` shape replaced the older `RestTimerPrefs` type that used to live in `rest-timer.tsx`. The rest-timer hook now narrows to the rest-\* subset via `Pick`, so its public surface is unchanged but the central source of truth is `lib/prefs.ts`.

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

The browse tab is **multi-select** by default. Tapping a row toggles a checkbox; the sticky footer shows a target summary, an optional balance hint (`lib/area-filter.ts → balanceHint`), and a single "Add N to session" button that calls `onPickMany`. The legacy single-pick `onPick` prop is gone — anything that wants to add exercises uses `onPickMany`.

Each **module header** in the browse tab also carries an "Add all N" / "Clear N" pill that toggles every exercise in that module into/out of the selection in one tap — driven by the same `selected` Set, so the user can mix module-bulk picks with row-by-row picks freely. Hidden in swap mode (single-select) and hidden when a module has only one visible exercise (the row checkbox is enough).

The picker also has a **swap mode**, opted into by passing the `swap` prop (`{ targetName, onPick }`). In swap mode the picker is single-select with instant commit: tapping any row fires `swap.onPick(id)` and closes. The "Add custom" tab is hidden, the title becomes "Replace [name]", and the row checkbox + footer summary disappear since neither has anything to do. Chips remain live so the user can widen the pre-filter. The workout-view's `startSwap` opens the picker pre-filtered to the outgoing exercise's primary muscles via `muscleIdsToChipIds`.

Above the search box are two rows of chips: regions (Upper / Lower / Full body / Mobility) and muscle groups (Chest / Back / Shoulders / Arms / Glutes / Quads / Hamstrings / Core). Selection is multi — chips are unioned with each other and with the search box. The "Full body" region chip is exclusive: tapping it clears every other chip. Tapping any non-Full chip cancels Full. The chip taxonomy and filter logic live in `lib/area-filter.ts` so other surfaces (empty state, future coverage→picker links) can reuse them.

When the workout-view empty state opens the picker after the user has tapped chips, those chips are passed in via `initialRegionIds` / `initialMuscleChipIds` so the picker boots already filtered. Mid-session "Add more exercises" reopens always start unfiltered — workout-view clears the pending chip state when the picker closes.

The browse tab's search matches name OR primary muscle OR secondary muscle, case-insensitive. If you add another searchable field to `Exercise`, update the filter.

The custom-add tab enforces `primary muscles >= 1`. The Zod schema in `createCustomExercise` enforces the same. These need to match.

## Templates

Save-from-active and start-from-template are fully implemented. There's no dedicated `/templates` management page yet — the empty-state list shows everything (built-in + user) inline.

**Built-in vs user templates**: built-ins (`isBuiltin: true`, `userId: null`) are seeded from `STARTER_TEMPLATES` in `lib/exercises-data.ts`. They're shared across all users. User templates are owned by the creating user. The picker shows both, sorted built-ins first. The `TemplateRow` component flips its trailing trash button between "Delete" (user) and "Hide" (built-in) based on `template.isBuiltin`. Hide writes a `UserHiddenTemplate` row; the user can unhide from the settings page.

If you add a new built-in template, edit `STARTER_TEMPLATES` and re-run `npm run db:seed`. The seeder rebuilds each built-in's exercise list on every run — there's no revision history (deliberate trade-off; users with their own customizations should fork to a user template).

`SaveTemplateDialog` does NOT close optimistically — it awaits the action and surfaces collision errors inline. Optimistic close would hide name-collision errors from the user (e.g. trying to save a template with a name they already used) by dismissing the dialog before the error fires.

## Things you might want to do that would be wrong

- **Reintroducing prop-drilled prefs.** Use the context.
- **`setInterval` with seconds-remaining state in the rest timer.** Use the absolute-deadline pattern.
- **Creating a fresh AudioContext per chime.** Reuse the singleton.
- **Treating `setNumber` as authoritative for ordering across exercises.** It's per-`(session, exercise)`, contiguous from 1. Cross-exercise ordering is `position`. Don't mix them.
- **Optimistically closing dialogs before action resolution.** Async flow with proper error surface, every time.
- **Adding "today's plan" UI.** See root CLAUDE.md — sessions are records, not plans.
