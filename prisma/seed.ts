// Seed the built-in exercises. Idempotent — safe to re-run after edits to exercises-data.ts.
//
// Usage:
//   npm run db:seed
//
// Notes:
// - Built-in exercises have ownerId = null, so they're shared across all users.
// - We upsert by (ownerId=null, name) which the schema marks as unique.
// - If an exercise is removed from the seed list, it's NOT auto-deleted from the DB —
//   that would orphan historical SetLogs. Mark as deletedAt manually if needed.

// Prisma 7's CLI no longer auto-loads .env, and tsx doesn't either, so the
// seed pulls dotenv in itself. The side-effect import is a no-op when the
// file isn't present (e.g. inside the Docker runtime, where env vars come
// from compose).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { SEED_EXERCISES, type SeedExercise } from '../lib/exercises-data';

// Default loadType for built-ins. SMR / Mobility / Balance have no
// meaningful external load; activation work that uses bands needs band
// tension rather than a number; everything else stays on numeric weight.
// The seed entry can pin an explicit `loadType` to override this — useful
// for the few activation movements that *are* weighted (Bulgarian split
// squats etc.), or strength items where the load should be hidden.
const WEIGHT_BEARING_EQUIPMENT = new Set(['barbell', 'dumbbells', 'cable', 'machine', 'rack']);
function deriveLoadType(ex: SeedExercise): 'weight' | 'band' | 'none' {
  if (ex.loadType) return ex.loadType;
  const mod = ex.module;
  if (mod.startsWith('SMR') || mod.startsWith('Mobility') || mod === 'Balance') {
    return 'none';
  }
  const equipment = ex.equipment ?? [];
  const hasWeightBearing = equipment.some((e) => WEIGHT_BEARING_EQUIPMENT.has(e));
  if (equipment.includes('bands') && !hasWeightBearing) return 'band';
  if (mod.startsWith('Activation') && !hasWeightBearing) return 'none';
  return 'weight';
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`Seeding ${SEED_EXERCISES.length} built-in exercises...`);

  let created = 0;
  let updated = 0;

  for (const ex of SEED_EXERCISES) {
    const existing = await prisma.exercise.findFirst({
      where: { ownerId: null, name: ex.name },
    });

    const loadType = deriveLoadType(ex);
    if (existing) {
      await prisma.exercise.update({
        where: { id: existing.id },
        data: {
          module: ex.module,
          prescription: ex.prescription,
          primaryMuscles: ex.primaryMuscles,
          secondaryMuscles: ex.secondaryMuscles ?? [],
          videoUrl: ex.videoUrl ?? null,
          metric: ex.metric ?? 'reps',
          loadType,
          equipment: ex.equipment ?? [],
          deletedAt: null, // Restore if previously soft-deleted
        },
      });
      updated++;
    } else {
      await prisma.exercise.create({
        data: {
          name: ex.name,
          module: ex.module,
          prescription: ex.prescription,
          primaryMuscles: ex.primaryMuscles,
          secondaryMuscles: ex.secondaryMuscles ?? [],
          videoUrl: ex.videoUrl ?? null,
          metric: ex.metric ?? 'reps',
          loadType,
          equipment: ex.equipment ?? [],
          isCustom: false,
          ownerId: null,
        },
      });
      created++;
    }
  }

  console.log(`Exercises — created: ${created}, updated: ${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
