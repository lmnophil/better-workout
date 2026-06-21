# prisma/CLAUDE.md

Schema, migrations, and seed data live here. Read the root `CLAUDE.md` first if you haven't.

## Schema changes — single-init policy

This project keeps **one** migration: `prisma/migrations/<timestamp>_init/`. Every schema change squashes back into that single init migration rather than stacking new ones. The seed rebuilds the data we care about, so a fresh DB from a single migration is the source of truth — and the project status (`CLAUDE.md`) treats this as permanent, not transitional.

After editing `schema.prisma`, regenerate the init (both `prisma migrate` commands require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` when run by Claude — see root CLAUDE.md):

```bash
rm -rf prisma/migrations/*_init
npx prisma migrate reset --force          # drops DB + migration history
npx prisma migrate dev --name init        # generates a fresh init from the schema and applies it

# MANUAL STEP — re-apply the two partial unique indexes Prisma can't express (see
# "Raw partial indexes" below). Hand-edit the new prisma/migrations/*_init/migration.sql:
#   1. append `WHERE "deletedAt" IS NULL` to the Exercise_ownerId_name_key index
#   2. add the WorkoutSession_userId_active_key partial unique index
npx prisma migrate reset --force          # re-applies the hand-edited migration, runs seed
npm run db:seed                            # idempotent belt (the reset above already seeds)
```

`migration_lock.toml` stays put across resets.

**Don't skip the manual step.** `migrate dev --name init` regenerates `migration.sql` purely from the schema, which can't carry the `WHERE` clauses — so a regen that omits the hand-edit silently downgrades both indexes to full (or drops the active-session one entirely), reviving the delete-then-recreate crash and the two-tabs double-active-session bug. Diff the generated `migration.sql` against the partial-index block below before resetting.

## Raw partial indexes

Two unique constraints are **partial** — they only apply to a subset of rows via a `WHERE` clause. Prisma's `@@unique` can't express `WHERE`, so they live as hand-edited raw SQL in the init migration (the schema keeps a comment at each site pointing here). After any schema regen, re-apply them by hand (see the recipe above):

```sql
-- Exercise: only LIVE customs are unique per owner, so a soft-deleted custom
-- doesn't block recreating a live one with the same name.
CREATE UNIQUE INDEX "Exercise_ownerId_name_key" ON "Exercise"("ownerId", "name") WHERE "deletedAt" IS NULL;

-- WorkoutSession: at most one in-progress session per user.
CREATE UNIQUE INDEX "WorkoutSession_userId_active_key" ON "WorkoutSession"("userId") WHERE "completedAt" IS NULL;
```

Both are caught in `lib/actions.ts` via `isUniqueViolation` (P2002): the active-session create paths surface the friendly "already have a workout in progress" error (or, in `getOrCreateActiveSession`, adopt the winner's session); `createCustomExercise` surfaces the duplicate-name error. They're a backstop for races the app-level pre-checks can't close (two tabs), not the primary guard.

The seed (`seed.ts`) is idempotent — re-running it is safe and necessary after a reset.

## Built-in vs custom (Exercise) and built-in vs user (WorkoutTemplate)

The structural split (`ownerId=null` / `userId=null` vs. the user's id) is in [`docs/data-model.md`](../docs/data-model.md). The operational rules:

- **Don't split the models.** A unified `Exercise` lets the picker render one list and `requireAvailableExercise()` does one ownership check covering both (`OR: [{ ownerId: null }, { ownerId: userId }]`). Same shape on `WorkoutTemplate`.
- **The `@@unique([userId, name])` (and equivalent on `Exercise`) relies on Postgres treating NULLs as distinct.** `(null, 'Push')` and `(userId, 'Push')` coexist. The seed is responsible for not creating duplicates among built-ins; the action layer enforces the user side.
- **Built-in templates have no revision history.** Re-running the seed rebuilds each built-in's exercise list from scratch. Users who want a customized version should fork to a user template (`saveActiveAsTemplate`).
- **`hideTemplate` and `deleteTemplate` enforce the split.** `hideTemplate` requires `isBuiltin: true`; `deleteTemplate` requires the inverse. The settings page exposes the unhide UI.

## Soft-delete

`Exercise.deletedAt` is set when a user removes a custom exercise; the row stays so referencing `SetLog`s aren't orphaned. `SetLog.exercise` uses `Restrict` (not `Cascade`) — a hard delete would be blocked at the DB level.

The `(ownerId, name)` unique index is **partial** — `WHERE "deletedAt" IS NULL` (see "Raw partial indexes") — so only live customs collide. Deleting a custom and recreating one with the same name works; the old soft-deleted row keeps its name in history.

If you write a query that lists exercises, **include `deletedAt: null` in the where clause**. A soft-deleted exercise reappearing in the picker is a bug.

`seed.ts` intentionally clears `deletedAt` on built-ins it touches, so any built-in that was somehow soft-deleted gets restored on the next seed run. A self-healing belt — built-ins shouldn't get there in normal flow because the UI doesn't expose a delete for them.

## Prisma 7 layout

A few v7-specific things that bite if you assume v6 patterns:

**Generated client lives in the project tree, not `node_modules`.** The generator outputs `prisma/generated/prisma/` (gitignored, regenerated on every `prisma generate`). The PrismaClient export is at `prisma/generated/prisma/client` — note the `/client` suffix. Importing the directory itself fails under ESM resolution (no `package.json` exports map). Both `lib/db.ts` and `prisma/seed.ts` use the `/client` import path; new code should too.

**Driver adapter, not query engine.** v7 ships pure JS — there's no Rust binary to ship. `lib/db.ts` constructs `PrismaPg` from `@prisma/adapter-pg` with `process.env.DATABASE_URL` and passes it to `new PrismaClient({ adapter, log: [...] })`. `client.$on('query'|'error'|'warn', ...)` event listeners still work; that's how slow-query logging and the Prometheus histogram are wired up. (If a future Prisma drops `$on`, fall back to a `client.$extends({ query: { ... } })` extension.)

**`prisma.config.ts` replaces `package.json#prisma`.** It sets the schema path, migrations path, seed command, and the datasource URL. Two non-obvious things:

- The datasource is built conditionally — `datasource: process.env.DATABASE_URL ? { url: env('DATABASE_URL') } : undefined`. The `env()` helper is eager and throws at config-load time if the var is missing, which would break `prisma generate` during the Docker build (no DB env at build time). The conditional sidesteps that.
- `import 'dotenv/config'` at the top because v7's CLI no longer auto-loads `.env`. `prisma/seed.ts` does the same for the same reason.

## Seed compilation

`seed.ts` is TypeScript. In development it runs via `tsx`. In the Docker build it gets bundled to `seed.js` via esbuild (see `Dockerfile`) so the runtime image doesn't need `tsx`. The bundle is **ESM** (because `package.json` sets `"type": "module"`) and uses `--packages=external`, which keeps everything from `node_modules` out of the bundle while still inlining the generated client (which is local code under `prisma/generated/`). The runtime image gets the prod-deps node_modules wholesale, so the externals resolve at runtime.

If you add an import to `seed.ts`, verify it's bundleable (no Node native modules, no things that require ts-node/tsx semantics).

To run the seed against a running compose stack, use `docker compose exec app node prisma/seed.js` — `docker compose run app node prisma/seed.js` will be ignored because `entrypoint.sh` hardcodes `node server.js` instead of forwarding `$@`.

## Indexes worth knowing about

- `WorkoutSession`: indexed on `(userId, date)` and `(userId, completedAt)`, plus the `(userId) WHERE "completedAt" IS NULL` partial unique (see "Raw partial indexes"). The first powers history queries; the second/third power the "find active session" lookup.
- `SetLog`: indexed on `(sessionId, position)` for ordered fetches when rendering the active session, and a `(sessionId, exerciseId, setNumber)` unique that enforces contiguous set numbering.
- `Exercise`: indexed on `ownerId` and `module`. The `(ownerId, name)` unique is **partial** (`WHERE "deletedAt" IS NULL`) — only live customs collide.
- `TemplateExercise`: indexed on `(templateId, position)` and on `poolId`. `TemplatePool`: indexed on `templateId`.
- FK indexes for cascade deletes / anti-joins: `RoutineDay.templateId`, `ShareComment.reviewerId`, `ShareSuggestion.reviewerId`, `Account.userId`. `ShareReaction.reviewerId` is intentionally *not* separately indexed — it's the leftmost column of the `(reviewerId, targetType, targetId, kind)` unique, which already serves reviewer-scoped lookups.

If you add a query that doesn't fit one of these indexes and runs frequently (`getCoverageData` etc), check the slow-query log (anything > 100ms hits stderr) before adding a new index.

## Schema invariants the app relies on

- At most one `WorkoutSession` per user with `completedAt: null`. DB-enforced by the `WorkoutSession_userId_active_key` partial unique index (see "Raw partial indexes"); the find-then-create paths catch the violation as a friendly error and `findActiveSession` still orders by date desc. This reverses the original app-only decision — see `docs/decisions.md`.
- Every `SetLog` for the same exercise within a session shares the same `position` value. `addSet` inherits position from the existing setLogs.
- `setNumber` within `(sessionId, exerciseId)` is contiguous starting from 1, with a unique index on `(sessionId, exerciseId, setNumber)` backstopping it. `removeSet` renumbers atomically (only ever shifting numbers downward in ascending order, which never transiently collides); `addSet` uses `lastSet.setNumber + 1` and retries against the new max if a concurrent double-fire took that number (P2002).
- `Exercise.primaryMuscles` has at least one entry. Validated in `createCustomExercise` Zod schema.
- `SetLog.weight` and `SetLog.bandId` are mutually exclusive in normal use. The exercise's `loadType` dictates which is meaningful — `'weight'` populates `weight`, `'band'` populates `bandId`, `'none'` leaves both null. `updateSet` enforces this both ways: setting a real `bandId` clears `weight`, and setting a real `weight` clears `bandId` (band wins if a stale client sends both).
- `Band.position` is contiguous starting from 0 within a user. `deleteBand` compacts after a delete so the picker doesn't render with gaps.
- **Every `RoutineDay` points at a template that the user owns** (`WorkoutTemplate.userId = the routine's user`, not a built-in). `createRoutineFromDraft` clones built-ins into user-owned copies before linking, and `swapInRoutineTemplate`/the share-apply actions mutate the day's template directly on the strength of this invariant. If you ever build a path that points a `RoutineDay` at a built-in template, the apply paths in `lib/actions.ts → applyShareSwap` and friends will corrupt the shared built-in for every user.
- **A `TemplatePool`'s members occupy a contiguous run of `TemplateExercise.position` values.** App-enforced via `gatherPoolMembers` + `normalizeTemplatePositions` in `lib/actions.ts`, called by every template-mutating action. Also: `TemplatePool.pickCount` is always in `1..members.length` — `removeExerciseFromRoutineDay` clamps it (and dissolves a pool that drops below 2 members), `updateTemplatePool`/`createTemplatePool` clamp on write, and `removeExerciseFromPool` (ungroup one member, keeping it in the day) likewise dissolves a pool that would fall below 2. Contiguity is for display/seed-order; `startFromRoutineDay` filters by `poolId` so a non-contiguous state degrades cosmetically, not functionally. The share-apply remove/insert paths don't re-normalize — acceptable for the niche "share suggestion on a pooled day" case; the next pool-aware action self-heals it.
- `ShareSuggestion.payload` shape depends on `kind`; the source of truth for the union is `SuggestionPayloadSchema` in `lib/actions.ts`. Adding a new suggestion `kind` means updating that union _and_ the rendering in `components/share-owner/share-detail.tsx → SuggestionSummary` (owner view) and `components/share/target-thread.tsx → SuggestionInline` (reviewer view). The schema itself doesn't constrain — it's `Json`.

If you add an action that writes `SetLog` or `WorkoutSession`, check you preserve all of the above.

## Things you might want to do that would be wrong

- **Dropping the `WorkoutSession_userId_active_key` partial unique index and trusting the app check alone.** It used to be app-only; it's now DB-enforced (see "Raw partial indexes" and the reversal ADR in `docs/decisions.md`). The `findFirst`-ordered-by-date check only papers over duplicates after the fact — it doesn't stop two tabs from creating them. Keep both.
- **Adding `dayFocus` or `type` to `WorkoutSession`.** Sessions are records, not plans. The plan lives on the routine via `RoutineDay`; `WorkoutSession.startedFromRoutineDayId` is the only acknowledgment a session has of any plan, and even that's nullable. See root CLAUDE.md.
- **Hard-deleting `Exercise` rows.** Use soft-delete. The Restrict on `SetLog.exercise` will block hard-deletes anyway — that's by design.
- **Changing muscle IDs from strings to an enum.** They're user-extensible (custom exercises pick from `MUSCLE_GROUPS` but the schema doesn't constrain) and the spaces/casing are deliberate. See `docs/decisions.md`.
- **Making `prisma.config.ts`'s datasource unconditional.** The conditional exists so `prisma generate` works at Docker build time when there's no DB. Removing the conditional breaks the image build. If you need to set the URL inline always, set it via `process.env.DATABASE_URL ?? '<placeholder>'` rather than dropping the conditional.
- **Importing the generated client as `from './generated/prisma'`.** ESM can't resolve directory imports without an exports manifest. The entry is `from './generated/prisma/client'`.
- **Allowing more than one routine per user.** Enforced by `@unique` on `Routine.userId`. The single-operator UX assumes one routine; multiple-routine support is documented as deferred in `docs/decisions.md`.
- **Lifting the routine-day cap.** `MAX_ROUTINE_DAYS = 7` in `lib/routine.ts` is enforced in actions. The timeline UI assumes a bounded list. Raising it requires UI work and a renewed look at the decision in `docs/decisions.md`.
