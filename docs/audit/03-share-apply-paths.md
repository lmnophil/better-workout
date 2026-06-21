# Package 3: Share suggestion apply-path correctness

Read [README.md](README.md) first. Line numbers as of `94365db` — re-locate by symbol.
Read `docs/api.md` (ordering/pool invariants) and the share ADRs in `docs/decisions.md`.

## Root cause

The owner-side `applyShare*` actions in `lib/actions.ts` (~3400-3860) are near-copies of the
routine-editor mutations written later and without the same discipline. The editor paths
maintain three invariants the apply paths drop: pool maintenance (dissolve below 2 members,
clamp `pickCount`), pool position contiguity (via `normalizeTemplatePositions`), and
pending-swap cleanup. Fixing the bugs individually is necessary but not sufficient — the right
fix probably extracts the shared logic so the two paths _can't_ diverge again. You're trusted
to choose the factoring.

## Findings

1. **`applyShareRemove` (actions.ts:3597-3629) bypasses pool maintenance and pending-swap
   cleanup.** Compare `removeExerciseFromRoutineDay` (2085-2130), which dissolves a pool that
   drops below 2 members, clamps `pickCount` to member count, and deletes pending swaps
   referencing the removed exercise. Applying a remove suggestion against a pool member can
   leave a 1-member pool, `pickCount > memberCount`, and orphaned `RoutineDayPendingSwap` rows.

2. **`applyShareReorder` (3666-3677) and `applyShareInsert` (3742-3766) write raw positions**,
   breaking the documented invariant that pool members occupy a contiguous position run. Every
   editor mutation path runs `normalizeTemplatePositions` (2012, 2123, 2277, 2456, 2577); these
   two don't.

3. **Early-return paths mutate without `revalidatePath`:** `applyShareSwap` when
   `outExerciseId === inExerciseId` (3532-3538) and `applyShareInsert` when all suggested
   exercises are already present (3728-3734) mark the suggestion `applied` and return — the
   shares page keeps showing it as open.

4. **`applyShareCustomExercise` (3804-3848) is non-transactional and re-apply unsafe.** Three
   sequential writes with no `$transaction`; a failure after the create leaves the suggestion
   open and a re-apply duplicates. The `${name} (suggested)` collision fallback isn't itself
   collision-checked → raw P2002 on second apply. Contrast `createCustomExercise`, which is
   transactional.

5. **`applyShareSwap` (3540-3576) is a near-copy of `swapInRoutineTemplate` (2870-2918)** minus
   the pool/pending-swap discipline — the divergence behind findings 1-2. Candidate for the
   shared-helper extraction.

6. **Duplication cluster:** the suggestion fetch + `state !== 'open'` + ownership boilerplate
   repeats verbatim across six apply/resolve actions (3413-3848). A `requireOpenSuggestion`-
   style helper fixes the consistency bugs in one place. Same story for pool dissolve/clamp,
   duplicated between `removeExerciseFromRoutineDay` (2098-2120) and `removeExerciseFromPool`
   (2554-2575) but missing from `applyShareRemove`.

7. **Minor, same area:** `applyShareInsert` awaits `requireAvailableExercise` per-exercise in a
   loop (3725-3727) — the batch pattern exists at actions.ts:197-210 and 1508-1519.
   `cloneTemplateForUser` (1462-1469) drops `plannedWeight` while `duplicateRoutineDay` (2737)
   copies it — nothing currently writes `plannedWeight`, but make them consistent or note the
   field as vestigial in your summary.

## Constraints

- All mutations stay in `lib/actions.ts`; full convention stack (withLogging, ownership
  scoping, Zod, revalidatePath) applies.
- Reviewers propose; the owner accepts. Don't move any apply logic to the public action side.
- Use Package 1's error transport for expected failures if it has landed; otherwise stable
  message prefixes in `EXPECTED_MESSAGES`.
- The CLAUDE.md claim that exactly four mutations skip `requireUser()` is already stale —
  `deleteShareSuggestion`/`deleteShareComment` (4141-4182) also skip it legitimately (cookie +
  reviewerId scoping; audited as sound). Fix the doc while you're here.

## Verification

Mint a share, register as a reviewer in a second browser context (Playwright MCP), file each
suggestion type, and apply them as the owner. Specifically:

- Apply a remove against a 2-member pool → pool dissolves, no orphan pending swaps
  (check the DB), `pickCount` never exceeds member count.
- Apply a reorder that would interleave a pool → pool block stays contiguous (verify positions
  in the DB and that the editor renders sanely).
- Apply a swap where out === in, and an insert where everything's already present → suggestion
  visibly resolves on the shares page without a manual refresh.
- Apply the same custom-exercise suggestion twice (force the first to fail mid-way if you can,
  or just re-apply) → no raw P2002, no duplicate exercise.
- `npm run typecheck && npm run lint`.
