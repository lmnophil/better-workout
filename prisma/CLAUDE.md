# prisma/CLAUDE.md

Schema, migrations, and seed data live here. Read the root `CLAUDE.md` first if you haven't.

## Schema changes

After editing `schema.prisma`, run:

```bash
npm run db:migrate dev    # creates a migration, applies it locally
```

Don't edit existing migration files — they're committed and other environments rely on them being stable. If the migration came out wrong, roll forward with another migration rather than rewriting history.

The seed (`seed.ts`) is idempotent — re-running it after schema changes is safe and often necessary if you renamed/recategorized something.

## Built-in vs custom exercises

The `Exercise` model serves both. The distinction:

- **Built-in:** `ownerId` is null, `isCustom` is false. Shared across all users. Comes from `lib/exercises-data.ts` via the seed.
- **Custom:** `ownerId` is the user's id, `isCustom` is true. Scoped to that user.

Don't merge them. Don't add a separate `BuiltinExercise` model. The unified model is what lets the picker show them in one list and lets `requireAvailableExercise()` do one ownership check covering both cases (`OR: [{ ownerId: null }, { ownerId: userId }]`).

## Soft-delete

`Exercise.deletedAt` is set when a user removes a custom exercise. The exercise is hidden from all queries that filter `deletedAt: null`, but `SetLog` rows referencing it stay intact. This is why we use Restrict (not Cascade) on `SetLog.exercise`.

If you write a query that lists exercises, **include `deletedAt: null` in the where clause**. The existing queries do this; new ones must too. A soft-deleted exercise reappearing in the picker is a bug.

The `seed.ts` script intentionally clears `deletedAt` on built-ins it touches — so a built-in that was somehow soft-deleted gets restored on the next seed run. This shouldn't happen for built-ins (the UI doesn't expose a delete for them), but it's a self-healing belt.

## Seed compilation

`seed.ts` is TypeScript. In development it runs via `tsx`. In the Docker build it gets compiled to `seed.js` via esbuild (see `Dockerfile`) so the runtime image doesn't need `tsx`. This means:

- The seed can `import` from anywhere in `lib/` at dev time.
- Build-time bundling pulls all imports into one file, so the runtime image only needs Node + Prisma client.
- `@prisma/client` is marked external in the bundle — it's already in the runtime image as a generated module.

If you add an import to `seed.ts`, verify it's bundleable (no Node native modules, no things that require ts-node/tsx semantics).

## Indexes worth knowing about

- `WorkoutSession`: indexed on `(userId, date)` and `(userId, completedAt)`. The first powers history queries; the second powers the "find active session" lookup.
- `SetLog`: indexed on `(sessionId, position)` for ordered fetches when rendering the active session.
- `Exercise`: indexed on `ownerId` and `module`. The `(ownerId, name)` unique constraint enforces "users can't have two customs with the same name."

If you add a query that doesn't fit one of these indexes and runs frequently (`getCoverageData` etc), check the slow-query log (anything > 100ms hits stderr) before adding a new index.

## Schema invariants the app relies on

- At most one `WorkoutSession` per user with `completedAt: null`. App-enforced — see `docs/decisions.md` for why not DB-enforced.
- Every `SetLog` for the same exercise within a session shares the same `position` value. `addSet` inherits position from the existing setLogs.
- `setNumber` within `(sessionId, exerciseId)` is contiguous starting from 1. `removeSet` renumbers atomically; `addSet` always uses `lastSet.setNumber + 1`.
- `Exercise.primaryMuscles` has at least one entry. Validated in `createCustomExercise` Zod schema.

If you add an action that writes `SetLog` or `WorkoutSession`, check you preserve all of the above.

## Things you might want to do that would be wrong

- **Adding a unique partial index on `(userId)` where `completedAt is null`.** Tempting but Prisma's support is awkward and the app-level check is sufficient. See `docs/decisions.md`.
- **Adding `dayFocus` or `type` to `WorkoutSession`.** Sessions are records, not plans. See root CLAUDE.md.
- **Hard-deleting `Exercise` rows.** Use soft-delete. The Restrict on `SetLog.exercise` will block hard-deletes anyway — that's by design.
- **Changing muscle IDs from strings to an enum.** They're user-extensible (custom exercises pick from `MUSCLE_GROUPS` but the schema doesn't constrain) and the spaces/casing are deliberate. See `docs/decisions.md`.
