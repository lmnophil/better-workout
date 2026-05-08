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

import { PrismaClient } from '@prisma/client';
import { SEED_EXERCISES } from '../lib/exercises-data';

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${SEED_EXERCISES.length} built-in exercises...`);

  let created = 0;
  let updated = 0;

  for (const ex of SEED_EXERCISES) {
    const existing = await prisma.exercise.findFirst({
      where: { ownerId: null, name: ex.name },
    });

    if (existing) {
      await prisma.exercise.update({
        where: { id: existing.id },
        data: {
          module: ex.module,
          prescription: ex.prescription,
          primaryMuscles: ex.primaryMuscles,
          secondaryMuscles: ex.secondaryMuscles ?? [],
          videoUrl: ex.videoUrl ?? null,
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
          isCustom: false,
          ownerId: null,
        },
      });
      created++;
    }
  }

  console.log(`Done. Created: ${created}, Updated: ${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
