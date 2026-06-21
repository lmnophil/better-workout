# Pre-testing audit briefs

A six-agent audit of the whole codebase was run at commit `94365db` (2026-06-09), before the
first round of early testing. Findings were grouped into nine focused work packages, one brief
per file in this directory. Each brief is meant to be executed by a single fresh Claude session.

## How to use these briefs (read this first, executing session)

- **The brief is the map, not the territory.** It states the problem, the evidence, the
  constraints, and any decisions the user already made. It deliberately does NOT prescribe the
  implementation — you are trusted to find the best solution. If the brief's suggested direction
  looks wrong once you're in the code, do the better thing and say why.
- **Line numbers are approximate.** They were accurate at `94365db`; earlier packages will have
  shifted them. Re-locate by symbol name, not line.
- **Re-verify each finding before fixing it.** A prior package may have already fixed or mooted
  it. If a finding turns out to be wrong, say so and skip it — don't fix a non-bug.
- **Read `CLAUDE.md` at the repo root first**, and the docs it points you to for your area.
  The conventions there (withLogging, requireUser, Zod, revalidatePath, EXPECTED_MESSAGES,
  single-init migration policy) are binding.
- **Verify, don't just typecheck.** Run `npm run typecheck` and `npm run lint`, and for anything
  user-visible, drive the dev server with the Playwright MCP. Each brief has a Verification
  section with the specific flows to exercise.
- **Stay in scope.** Fix what your brief covers. If you find a new issue, surface it in your
  summary rather than fixing it silently.
- **Update docs per the maintenance contract** in CLAUDE.md (EXPECTED_MESSAGES, data-model,
  ADRs in docs/decisions.md for design decisions, prisma/CLAUDE.md for schema invariants).
- When the package is done, mark its row in the table below (`done` + date) so later sessions
  know the state of the world.

## Execution order

Order matters for 1 → 2 (the error-transport convention from package 1 is what package 2
surfaces in the UI) and loosely for 1 → 3. Packages 4–9 are independent of each other and of
1–3; run them in any order, though 4 and 5 are the next most user-visible.

| #   | Brief                                                                | Theme                                                        | Status            |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------- |
| 1   | [01-error-transport.md](01-error-transport.md)                       | Expected errors survive prod; EXPECTED_MESSAGES sync         | done (2026-06-09) |
| 2   | [02-client-action-discipline.md](02-client-action-discipline.md)     | Await actions, real isPending, surface errors                | done (2026-06-21) |
| 3   | [03-share-apply-paths.md](03-share-apply-paths.md)                   | Share suggestion apply-path correctness                      | done (2026-06-21) |
| 4   | [04-domain-logic-and-presets.md](04-domain-logic-and-presets.md)     | Starter presets, day/recency math, timezone, volume counting | done (2026-06-21) |
| 5   | [05-schema-races-and-integrity.md](05-schema-races-and-integrity.md) | Schema-backed race fixes, soft-delete vs unique              | done (2026-06-21) |
| 6   | [06-pwa-offline-auth-recovery.md](06-pwa-offline-auth-recovery.md)   | Offline fallback, HTTPS cookie-recovery loop                 | pending           |
| 7   | [07-security-config-hardening.md](07-security-config-hardening.md)   | allowedOrigins, XFF, URL schemes, email leak                 | pending           |
| 8   | [08-ops-and-repo-hygiene.md](08-ops-and-repo-hygiene.md)             | backup.sh, .dockerignore, DEPLOY.md, repo cruft              | pending           |
| 9   | [09-shared-ui-consolidation.md](09-shared-ui-consolidation.md)       | Dedupe divergent re-implementations, UX polish               | pending           |

## Deferred (real, but not testing-blockers — pick up opportunistically)

- Query over-fetch: `getCoverageData`/`getWeeklyVolume` pull a joined exercise-muscles payload
  per set row; `getLastSetsForExerciseIds` / `getLastSetsByExercise` fetch every session in the
  180-day window when they need the most recent per exercise. Fine single-user; revisit if the
  slow-query log lights up.
- Workout page waterfall: `getLastSetsByExercise` awaits after the full `Promise.all` of 7
  queries in `app/(app)/page.tsx` but only depends on `getActiveSession`. Chainable.
- `auth()` runs an un-deduped `db.user.findUnique` at least twice per request (layout + page).
  A `React.cache`-wrapped helper would dedupe it.
- `setRoutineDayExerciseOrder` does ~4N sequential updates with a sentinel dance justified by a
  unique index that doesn't exist (`(templateId, position)` is a plain index). Could be one
  `writeTemplatePositions` pass.
- `lib/actions.ts` duplication: `setExerciseRestOverride`/`setExerciseWeightIncrement` are
  mirror-image actions differing only in field name.

## Suggested follow-up after packages land

A hands-on **design/UX review session**: drive the real app via the Playwright MCP through the
core flows (start workout → log sets → complete; build a routine from a preset; share → review →
apply) and judge flow, hierarchy, and mobile ergonomics. The audit reviewed code, not the lived
experience — nobody has yet evaluated the app the way an early tester will.
