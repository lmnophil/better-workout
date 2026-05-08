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

## Built-in vs user workout templates

`WorkoutTemplate` follows the same split:

- **Built-in:** `userId` is null, `isBuiltin` is true. Shared. Seeded from `STARTER_TEMPLATES` in `lib/exercises-data.ts`. Users see them in the picker alongside their own templates and can hide any via `UserHiddenTemplate`, but can't delete or edit them. Re-running the seed rebuilds each built-in's exercise list from scratch (no revision history; that was the explicit scoping decision).
- **User:** `userId` is set, `isBuiltin` is false. Owned by the creating user. `saveActiveAsTemplate` always creates this kind.

The `@@unique([userId, name])` constraint relies on Postgres NULL semantics: two built-ins with the same name don't collide at the constraint level (NULLs are treated as distinct), so the seed is responsible for not creating duplicates. A user creating a custom template with the same name as a built-in (e.g. "Push") is fine — the unique key for `(null, 'Push')` and `(userId, 'Push')` is distinct. The UI uses the "Default" tag on built-ins to keep them visually separable.

`UserHiddenTemplate` is a per-user side-table (mirrors `ExerciseUserSettings` shape). Inserting a row hides the template from `getTemplates`; deleting it unhides. The settings page exposes a list of hidden templates with an unhide button. `hideTemplate` enforces that the target is built-in; `deleteTemplate` enforces the inverse.

## Soft-delete

`Exercise.deletedAt` is set when a user removes a custom exercise. The exercise is hidden from all queries that filter `deletedAt: null`, but `SetLog` rows referencing it stay intact. This is why we use Restrict (not Cascade) on `SetLog.exercise`.

If you write a query that lists exercises, **include `deletedAt: null` in the where clause**. The existing queries do this; new ones must too. A soft-deleted exercise reappearing in the picker is a bug.

The `seed.ts` script intentionally clears `deletedAt` on built-ins it touches — so a built-in that was somehow soft-deleted gets restored on the next seed run. This shouldn't happen for built-ins (the UI doesn't expose a delete for them), but it's a self-healing belt.

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
- **Making `prisma.config.ts`'s datasource unconditional.** The conditional exists so `prisma generate` works at Docker build time when there's no DB. Removing the conditional breaks the image build. If you need to set the URL inline always, set it via `process.env.DATABASE_URL ?? '<placeholder>'` rather than dropping the conditional.
- **Importing the generated client as `from './generated/prisma'`.** ESM can't resolve directory imports without an exports manifest. The entry is `from './generated/prisma/client'`.
