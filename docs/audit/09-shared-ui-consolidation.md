# Package 9: Shared-UI consolidation and UX polish

Read [README.md](README.md) first, plus `components/workout/CLAUDE.md`. Line numbers as of
`94365db` — re-locate by symbol. Best run AFTER packages 2 and 3, which fix the bugs that
existing divergence already caused; this package removes the divergence so the next ones can't
happen. The user has been burned before by "different areas re-implementing the same feature
slightly differently" — that's the mandate here.

## A. The modal problem (the big one)

The modal shell (backdrop click-to-close, stopPropagation, Escape listener, `role="dialog"`
`aria-modal`) is re-implemented **seven times**: `exercise-picker.tsx`, `workout-view.tsx`
(SaveTemplateDialog), `use-confirm.tsx`, `pool-pick-dialog.tsx`, `routine-timeline.tsx`
(SwapChoiceDialog), `suggestion-builder.tsx` (ModalShell), `reviewer-picker.tsx`. Exactly ONE
(`pool-pick-dialog.tsx:68-112`) has the complete focus-trap / focus-restore / Escape
implementation; the other six declare `aria-modal="true"` while Tab walks the page behind the
overlay.

Extract one shared primitive (a `<ModalShell>` component and/or `useModal` hook — your design)
from the pool-pick-dialog implementation and migrate all seven. Behavioral details to preserve
or fix during migration:

- `SaveTemplateDialog` guards Escape while submitting — keep that, and consider it for all
  (Escape shouldn't abandon an in-flight submit).
- `exercise-picker.tsx:120-126` closes on Escape unconditionally, discarding a fully-typed
  custom-exercise form — add a dirty-state guard or confirm step for destructive closes.
- Also evaluate the native `<dialog>` element as the base — it gives focus management for free,
  but verify it fits the existing styling/animation approach before committing.

## B. Other divergent re-implementations

1. **`buildUsageStatsMap` + types live in `workout-view.tsx` and are imported by
   `routine-timeline.tsx` and `routine-editor.tsx`** — creating a circular import
   (workout-view ↔ routine-timeline) and dragging the whole session-UI module graph into the
   `/routine` client bundle. Move `buildUsageStatsMap`, `ExerciseInfo`,
   `ExerciseUsageStatClient` (and the `ExerciseUsageStat` type currently imported from
   `lib/queries` into client files) into `lib/` (e.g. `lib/usage-stats.ts`). Breaks the cycle,
   slims the bundle, and ends the "client file imports from queries.ts" rule-skirting.
2. **Coverage panel rendered twice:** `CoveragePanel`/`CoverageRow`/`SummaryStrip` in
   `routine-editor.tsx:3521-3844` vs `ShareCoveragePanel`/`ShareCoverageRow` in
   `share/share-coverage.tsx:59-223` — near-identical render logic over the same
   `TIER_VISUALS`; only data plumbing differs. Consolidate.
3. **Category-label map `{ lower: 'Lower body', … }` declared 3×** (routine-editor.tsx:3718,
   share-coverage.tsx:38, coverage-view.tsx:45). One definition, probably next to
   `MUSCLE_GROUPS`.
4. **Settings editors:** `Row` + custom-numeric-input blocks copy-pasted between
   `settings/rest-timer-editor.tsx` and `settings/workout-defaults-editor.tsx`; `Toggle` lives
   only in the former. Extract.
5. **`window.confirm` in `share-owner/shares-index.tsx`** for revoke, where everything else
   uses `useConfirm` — migrate it.
6. If Package 4 didn't already: the duplicated `daysBetween` in `coverage-view.tsx:73-76` dies
   in favor of the `lib/utils.ts` one.

## C. UX polish (small, verified findings)

1. **Rest timer flashes a wildly wrong time** on start (rest-timer.tsx:58-66,85): `start()`
   sets `endsAt` but `now` state is stale until the first 250ms tick — a 90s timer can render
   "31:30" briefly. `setNow(Date.now())` inside `start`.
2. **`VolumeTargetsEditor` row** (settings/volume-targets-editor.tsx): commit compares before
   `Math.round`, and the input never re-syncs after revalidation — typing `12.7` leaves "12.7"
   shown while the server stores 13. Also its `setTimeout(…, 1200)` has no unmount cleanup
   (SetRow's ref-based cleanup is the documented pattern).
3. **Exercise picker "Add N"** (exercise-picker.tsx:285): selections that the user has since
   filtered out of view stay selected and counted — surprising. Decide: clear hidden
   selections, or show them (e.g. a "N selected" chip row independent of filters). Either is
   fine; invisible-but-counted is not.
4. **Dead-intent expression** (share-owner/share-detail.tsx:300-304): `…map(…) || undefined` —
   empty array is truthy so `undefined` is unreachable; behavior is correct only because the
   server treats `[]` as "all". Make the intent real (length check) or drop it.
5. "Add more exercises" button in workout-view.tsx:639 is the only session control without
   `disabled={isPending}` — likely mooted by Package 2; verify and align.

## Constraints

- This is consolidation, not redesign — visual behavior should be unchanged except where a
  finding says otherwise (focus traps, Escape guards are deliberate changes).
- No new dependencies for modals/focus traps; the pool-pick-dialog implementation (or native
  `<dialog>`) is sufficient.
- Match existing component idiom and Tailwind usage; Prettier owns formatting.
- After the refactor, grep for leftover orphans (unused Toggle copies, dead ModalShell, etc.).

## Verification

Playwright MCP, against the dev server:

- Every dialog: open → Tab cycles inside only → Escape closes (except mid-submit / dirty
  guard) → focus returns to the opener.
- Routine editor and share coverage panels render identically to before (screenshot compare).
- Rest timer starts at the correct remaining time with no flash.
- Volume target: type `12.7`, blur → field shows the stored value.
- Revoke a share → styled confirm dialog, not the native one.
- `npm run typecheck && npm run lint`; check the `/routine` page's client bundle no longer
  pulls workout-session modules (build output / `next build` route sizes).
