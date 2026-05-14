# prisma/CLAUDE.md

Schema, migrations, and seed data live here. Read the root `CLAUDE.md` first if you haven't.

## Schema changes — single-init policy

This project keeps **one** migration: `prisma/migrations/<timestamp>_init/`. Every schema change squashes back into that single init migration rather than stacking new ones. The seed rebuilds the data we care about, so a fresh DB from a single migration is the source of truth — and the project status (`CLAUDE.md`) treats this as permanent, not transitional.

After editing `schema.prisma`, regenerate the init (both `prisma migrate` commands require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` when run by Claude — see root CLAUDE.md):

```bash
rm -rf prisma/migrations/*_init
npx prisma migrate reset --force          # drops DB, runs migrations (none), runs seed
npx prisma migrate dev --name init        # creates fresh init from current schema
npm run db:seed                            # re-seed (reset ran seed against an empty schema, so re-run after init)
```

`migration_lock.toml` stays put across resets.

The seed (`seed.ts`) is idempotent — re-running it is safe and necessary after a reset.

## Built-in vs custom (Exercise) and built-in vs user (WorkoutTemplate)

The structural split (`ownerId=null` / `userId=null` vs. the user's id) is in [`docs/data-model.md`](../docs/data-model.md). The operational rules:

- **Don't split the models.** A unified `Exercise` lets the picker render one list and `requireAvailableExercise()` does one ownership check covering both (`OR: [{ ownerId: null }, { ownerId: userId }]`). Same shape on `WorkoutTemplate`.
- **The `@@unique([userId, name])` (and equivalent on `Exercise`) relies on Postgres treating NULLs as distinct.** `(null, 'Push')` and `(userId, 'Push')` coexist. The seed is responsible for not creating duplicates among built-ins; the action layer enforces the user side.
- **Built-in templates have no revision history.** Re-running the seed rebuilds each built-in's exercise list from scratch. Users who want a customized version should fork to a user template (`saveActiveAsTemplate`).
- **`hideTemplate` and `deleteTemplate` enforce the split.** `hideTemplate` requires `isBuiltin: true`; `deleteTemplate` requires the inverse. The settings page exposes the unhide UI.

## Soft-delete

`Exercise.deletedAt` is set when a user removes a custom exercise; the row stays so referencing `SetLog`s aren't orphaned. `SetLog.exercise` uses `Restrict` (not `Cascade`) — a hard delete would be blocked at the DB level.

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

- `WorkoutSession`: indexed on `(userId, date)` and `(userId, completedAt)`. The first powers history queries; the second powers the "find active session" lookup.
- `SetLog`: indexed on `(sessionId, position)` for ordered fetches when rendering the active session.
- `Exercise`: indexed on `ownerId` and `module`. The `(ownerId, name)` unique constraint enforces "users can't have two customs with the same name."
- `TemplateExercise`: indexed on `(templateId, position)` and on `poolId`. `TemplatePool`: indexed on `templateId`.

If you add a query that doesn't fit one of these indexes and runs frequently (`getCoverageData` etc), check the slow-query log (anything > 100ms hits stderr) before adding a new index.

## Schema invariants the app relies on

- At most one `WorkoutSession` per user with `completedAt: null`. App-enforced — see `docs/decisions.md` for why not DB-enforced.
- Every `SetLog` for the same exercise within a session shares the same `position` value. `addSet` inherits position from the existing setLogs.
- `setNumber` within `(sessionId, exerciseId)` is contiguous starting from 1. `removeSet` renumbers atomically; `addSet` always uses `lastSet.setNumber + 1`.
- `Exercise.primaryMuscles` has at least one entry. Validated in `createCustomExercise` Zod schema.
- `SetLog.weight` and `SetLog.bandId` are mutually exclusive in normal use. The exercise's `loadType` dictates which is meaningful — `'weight'` populates `weight`, `'band'` populates `bandId`, `'none'` leaves both null. `updateSet` clears `weight` whenever `bandId` is being set.
- `Band.position` is contiguous starting from 0 within a user. `deleteBand` compacts after a delete so the picker doesn't render with gaps.
- **Every `RoutineDay` points at a template that the user owns** (`WorkoutTemplate.userId = the routine's user`, not a built-in). `createRoutineFromDraft` clones built-ins into user-owned copies before linking, and `swapInRoutineTemplate`/the share-apply actions mutate the day's template directly on the strength of this invariant. If you ever build a path that points a `RoutineDay` at a built-in template, the apply paths in `lib/actions.ts → applyShareSwap` and friends will corrupt the shared built-in for every user.
- **A `TemplatePool`'s members occupy a contiguous run of `TemplateExercise.position` values.** App-enforced via `gatherPoolMembers` + `normalizeTemplatePositions` in `lib/actions.ts`, called by every template-mutating action. Also: `TemplatePool.pickCount` is always in `1..members.length` — `removeExerciseFromRoutineDay` clamps it (and dissolves a pool that drops below 2 members), `updateTemplatePool`/`createTemplatePool` clamp on write. Contiguity is for display/seed-order; `startFromRoutineDay` filters by `poolId` so a non-contiguous state degrades cosmetically, not functionally. The share-apply remove/insert paths don't re-normalize — acceptable for the niche "share suggestion on a pooled day" case; the next pool-aware action self-heals it.
- `ShareSuggestion.payload` shape depends on `kind`; the source of truth for the union is `SuggestionPayloadSchema` in `lib/actions.ts`. Adding a new suggestion `kind` means updating that union _and_ the rendering in `components/share-owner/share-detail.tsx → SuggestionSummary` (owner view) and `components/share/target-thread.tsx → SuggestionInline` (reviewer view). The schema itself doesn't constrain — it's `Json`.

If you add an action that writes `SetLog` or `WorkoutSession`, check you preserve all of the above.

## Things you might want to do that would be wrong

- **Adding a unique partial index on `(userId)` where `completedAt is null`.** Tempting but Prisma's support is awkward and the app-level check is sufficient. See `docs/decisions.md`.
- **Adding `dayFocus` or `type` to `WorkoutSession`.** Sessions are records, not plans. The plan lives on the routine via `RoutineDay`; `WorkoutSession.startedFromRoutineDayId` is the only acknowledgment a session has of any plan, and even that's nullable. See root CLAUDE.md.
- **Hard-deleting `Exercise` rows.** Use soft-delete. The Restrict on `SetLog.exercise` will block hard-deletes anyway — that's by design.
- **Changing muscle IDs from strings to an enum.** They're user-extensible (custom exercises pick from `MUSCLE_GROUPS` but the schema doesn't constrain) and the spaces/casing are deliberate. See `docs/decisions.md`.
- **Making `prisma.config.ts`'s datasource unconditional.** The conditional exists so `prisma generate` works at Docker build time when there's no DB. Removing the conditional breaks the image build. If you need to set the URL inline always, set it via `process.env.DATABASE_URL ?? '<placeholder>'` rather than dropping the conditional.
- **Importing the generated client as `from './generated/prisma'`.** ESM can't resolve directory imports without an exports manifest. The entry is `from './generated/prisma/client'`.
- **Allowing more than one routine per user.** Enforced by `@unique` on `Routine.userId`. The single-operator UX assumes one routine; multiple-routine support is documented as deferred in `docs/decisions.md`.
- **Lifting the routine-day cap.** `MAX_ROUTINE_DAYS = 7` in `lib/routine.ts` is enforced in actions. The timeline UI assumes a bounded list. Raising it requires UI work and a renewed look at the decision in `docs/decisions.md`.
