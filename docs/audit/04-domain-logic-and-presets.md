# Package 4: Domain logic — starter presets, day math, timezone, volume counting

Read [README.md](README.md) first. Line numbers as of `94365db` — re-locate by symbol.
These are pure-logic fixes in `lib/` plus two decided design changes. Most are independently
verifiable by script — write throwaway `tsx` scripts where that's faster than UI testing.

## A. Starter presets (lib/starter-routines.ts) — hard-broken combinations

Reproduced by executing `buildStarterRoutine` across all 560 combinations (4 focuses × 7
day-counts × 4 durations × 5 equipment tiers):

1. **Longevity presets produce duplicate exercises in a day → save always fails.** On
   `bands-only` and `bodyweight-only` tiers, two slots in the same day cascade to the same
   exercise: `activationSlot` + `posteriorChainSlot` both fall back to Bodyweight glute bridge
   (lower days, 30/45/60 min); `pushSlot('build')` + `longevityChestAccessorySlot` both resolve
   to Banded chest press (bands) or Push-ups (bodyweight) on upper days (45/60 min). Affects
   every longevity preset 2–7 days. `freshTemplateForUser` (actions.ts:1504) then throws
   `"A day can't list the same exercise twice."` — the user gets a hard error with no fix
   available in the preset tab. Fix at the builder level (dedupe-aware slot resolution), not by
   relaxing the server validation.
2. **Equipment-starved days are silently dropped.** `bodyweight-only` at 15 min builds
   strength/build Pull days to zero exercises; `applyPreset`
   (components/routines/routine-editor.tsx:809) filters empty days out — a user who picked
   3-day PPL silently gets 2 days. Decide the UX: block the combination with an explanation,
   or keep the day with a visible "couldn't fill this day" notice. Silent shrink is the only
   wrong answer.
3. **Tradeoff message inflated:** `buildStarterRoutine` (1666-1674) checks equipment before
   duration, so `droppedAny` fires for slots the duration cutoff would have trimmed anyway.
   Swap the checks.
4. **`'mat'` gates variant selection** despite the comment at 145-149 calling it informational.
   The picker exposes mat as a toggle ("Floor / SMR"); unticking it silently loses Knee
   push-ups, 90/90s, hip thrusts, etc. Either make mat truly informational in `pickVariant`
   (1627-1632) or make the toggle's consequence visible.

## B. Day/recency math

5. **`daysBetween` (lib/utils.ts:6-9) uses elapsed 24-hour blocks, not calendar days**, despite
   its doc comment. A 9pm workout viewed at 7am shows "today"; coverage fresh/recent/stale
   tiers shift with time of day. Fix: truncate both dates to local midnight before diffing.
   There is a **duplicated copy** in `components/coverage/coverage-view.tsx:73-76` — fix both
   by deleting the copy and importing the one in `lib/utils.ts`.
6. **Notification inbox sorts unread LAST** (lib/queries.ts:723-729): `readAt: 'asc'` puts
   NULLs last in Postgres; with `take: 30` unread items can vanish entirely. Use
   `{ readAt: { sort: 'desc', nulls: 'first' } }` or equivalent.
7. **Weekday-mode "upcoming" includes today's day again** (lib/routine.ts:86-91): offset loop
   runs 1..7, wrapping to today. Decide intended behavior; sequence mode excludes today, and
   the function's own doc says ≤ MAX_ROUTINE_DAYS − 1 entries.

## C. Timezone — design decision needed (user constraints below)

8. **"Today's workout" resolves in the server's timezone** (lib/routine.ts:58,85 from
   app/(app)/page.tsx:112 with `new Date()`). In the documented Docker deployment that's UTC,
   so a US user's "today" flips at 4–8pm local.

   The user deliberately did NOT pick a mechanism (tz pref vs client offset vs something else)
   — you choose. Their acceptance criteria:
   - **The UI must make unambiguous which calendar day "today's workout" refers to** (e.g.
     label it with the weekday/date, not just "Today").
   - **A session that starts late and completes after midnight attributes to the day it
     STARTED** — including on consecutive nights (start 11pm Mon, finish 12:30am Tue; again
     11pm Tue → 12:30am Wed must count as Mon and Tue workouts: no double-count, no skipped
     day, and the weekday picker / recency labels / volume windows must all stay coherent with
     that attribution).

   Note `daysBetween` (finding 5) and coverage recency use local server time too — whatever
   timezone source you pick should feed all "what day is it" consumers, not just the routine
   picker. Record the design as an ADR in docs/decisions.md.

## D. Volume counting — decision already made

9. **Seeded-but-never-performed sets count toward volume/coverage/usage stats**
   (lib/queries.ts:360-391, 267-301, 315-347): `completeActiveSession` (actions.ts:517) keeps
   unfilled SetLogs, and the aggregations count every row. **Decided: prune unfilled sets —
   reps AND seconds both null — at `completeActiveSession`.** The `isSetFilled` notion already
   exists in `lib/time-estimate.ts:101`; keep one definition of "filled". Check whether
   anything else (time estimates, "last time" display) assumed those rows survive completion.

## E. Cleanup in the same area

10. **`lib/routine-coverage.ts` is dead code and stale** (no callers; predates the tier
    system). Delete it, or fold anything worth keeping into `lib/coverage.ts`.
11. **`ESTIMATED_SETS_FALLBACK = 3`** (lib/coverage.ts:177-179) claims to match the seeder, but
    seeding uses the user's `defaultSetsPerExercise` pref. Make the estimate use the pref.
12. **Cardio/balance exercises unreachable through picker chips** (lib/area-filter.ts:56-83):
    once any chip is selected, exercises whose only muscles are `cardio`/`balance` are filtered
    out. Possibly intended — investigate and either fix or document.
13. **Stale comment:** `getTemplates` (lib/queries.ts:463-465) claims recency-band sorting that
    the orderBy doesn't implement. Fix comment or code.

## Constraints

- No coaching features — the app reflects, it doesn't prescribe (CLAUDE.md / decisions.md).
- Schema changes, if your timezone design needs one (e.g. a tz column on `UserPreference`),
  follow the single-init migration policy in prisma/CLAUDE.md (squash, reset).
- The starter-preset verification script approach from the audit is the model: assert
  no-duplicate-exercises and no-empty-days across all 560 combinations before calling A done.

## Verification

- Script: all 560 preset combinations build with no intra-day duplicate exercises and no
  silently-vanishing days; then save a previously-broken combo (longevity × bands-only ×
  60 min) through the real UI (Playwright MCP).
- Notifications: seed 30+ read + 1 unread, confirm unread renders first.
- Midnight test: fake a session starting 23:50 and completing 00:20 (write rows directly or
  shift system clock assumptions in a script) and confirm attribution, volume windows, and
  recency labels per the acceptance criteria in C.
- Complete a session with 1 of 3 seeded sets filled → volume/coverage credit exactly 1.
- `npm run typecheck && npm run lint`.
