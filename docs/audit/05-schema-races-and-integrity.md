# Package 5: Schema-backed races and data integrity

Read [README.md](README.md) first. Line numbers as of `94365db` — re-locate by symbol.
Read `prisma/CLAUDE.md` before touching the schema: single-init migration policy (edit schema,
squash into `init`, reset with the consent flag), and the documented invariants
(SetLog.exerciseId stays `Restrict`; Exercise is soft-deleted via `deletedAt`).

These findings share a theme: check-then-write races and constraint mismatches that the
database could prevent but currently doesn't. They're batched because several fixes likely
touch `prisma/schema.prisma`, and schema changes here mean one squash-and-reset.

## Findings

1. **Soft-delete vs unique constraint — delete-then-recreate crashes.**
   `createCustomExercise` (actions.ts:727-758) checks name collisions with `deletedAt: null`,
   but `@@unique([ownerId, name])` (schema.prisma:165) includes soft-deleted rows. Deleting a
   custom exercise and recreating the same name passes the friendly check and throws raw P2002
   → generic crash, logged as a bug. Delete-then-recreate is a natural first-test flow.
   Candidate fixes: rename on soft-delete (e.g. timestamp suffix), a partial unique index
   (`WHERE "deletedAt" IS NULL` — Prisma can't declare it, but raw SQL in the init migration
   can), or include deleted rows in the pre-check with a "restore?" message. Your call;
   whatever you pick, document the invariant in prisma/CLAUDE.md.

2. **"At most one active session" has no DB backstop.** `getOrCreateActiveSession` (62-68),
   `startFromTemplate` (1219-1268), and `startFromRoutineDay` (3096-3197) all find-then-create
   with no transaction and no partial unique index on `(userId) WHERE "completedAt" IS NULL`.
   Two tabs / PWA + browser create two active sessions; one becomes invisible and permanently
   blocks `startFromTemplate` until a discard. The code comment at actions.ts:31-34
   acknowledges the race. A partial unique index (raw SQL in init migration) + catching the
   violation as the existing expected error is the obvious shape, but you're trusted to design.
   Package 2 reduces double-tap frequency; it can't fix cross-tab.

3. **`getUserBands` writes during render and can race** (lib/queries.ts:417-439): lazy seeding
   (`createMany` of 3 default bands) runs inside a query called from Server Component render;
   two concurrent first-touch requests → P2002 → error boundary on a user's first-ever page
   load. `skipDuplicates: true` or catch-and-refetch makes it safe; also consider whether
   seeding belongs in the auth `createUser` event instead of a read path (queries.ts is
   otherwise read-only by convention).

4. **`addSet` setNumber race** (actions.ts:299-321): read-max-then-create, no transaction, no
   unique on `(sessionId, exerciseId, setNumber)`. Double-fire → duplicate set numbers
   (self-heals on next removal's renumbering, but confusing). Same class:
   `addExercisesToActiveSession` (228-243) can produce duplicate positions (harmless,
   non-unique). Decide which deserve DB constraints vs transactions vs acceptance — note the
   reasoning.

5. **Empty-session cleanup race** (actions.ts:499-507, 264-270): two concurrent `removeSet`
   calls on the last two sets both see `remainingInSession === 0`, both `delete` → loser
   throws P2025, logged as a bug. `deleteMany` makes it idempotent.

6. **`toggleShareReaction` find-then-write race** (actions.ts:4100-4124): double-tap → P2002 or
   P2025 logged as bugs; also every re-toggle-on creates a fresh owner notification — decide if
   that's intended (a reviewer can spam the owner's inbox by toggling).

7. **Small schema hygiene while you're resetting anyway:** `RoutineDay.templateId` has no index
   (anti-join probes in `getTemplates`, FK cascade); un-indexed FKs `ShareComment.reviewerId`,
   `ShareSuggestion.reviewerId`, `ShareReaction.reviewerId`, `Account.userId`. Negligible at
   this scale — add them or consciously skip, one line in the summary either way.

8. **`updateRoutine` asymmetric guard** (actions.ts:1615-1627): `lastCompletedPosition` resets
   whenever `scheduleStyle` is _present_ even if unchanged, while the weekday-clearing branch
   correctly guards on actual change (1605). Reachable from a stale client. Make them
   symmetric. Related: `uniqueTemplateName` via `updateRoutineDay` (1406-1422, 1830-1835)
   doesn't exclude the template being renamed — sending the current name silently renames to
   `"Name (2)"`.

9. **`updateSet` mutual-exclusion is one-directional** (actions.ts:332-381): setting `bandId`
   clears `weight`, setting `weight` doesn't clear `bandId`, contradicting the documented
   contract. Implement the other direction.

## Constraints

- Single-init migration policy: edit schema, squash, reset with
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` per prisma/CLAUDE.md. Raw-SQL partial indexes
  belong in the init migration with a comment, and documented in prisma/CLAUDE.md.
- New expected errors (e.g. surfacing a constraint violation as user-facing) follow Package 1's
  transport if landed, else EXPECTED_MESSAGES.
- Update docs/data-model.md if relationships/invariants change.

## Verification

- Delete a custom exercise, recreate same name → friendly behavior, no P2002.
- Two browser tabs, start a workout in both rapidly → exactly one active session, second tab
  gets the expected error (after Package 2: rendered visibly).
- Fresh user (wipe `.playwright-profile` or use a second account), first page load → bands
  seeded once, no boundary error (hammer with parallel curls if needed).
- Concurrency scripts (parallel action invocations via a tsx script hitting the DB layer) for
  the addSet/removeSet/toggleReaction races you chose to fix.
- `npm run typecheck && npm run lint`; reset + reseed completes cleanly.
