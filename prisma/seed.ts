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
import { SEED_EXERCISES, STARTER_TEMPLATES } from '../lib/exercises-data';

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

  console.log(`Exercises — created: ${created}, updated: ${updated}`);

  console.log(`Seeding ${STARTER_TEMPLATES.length} built-in templates...`);
  await seedStarterTemplates();
}

/**
 * Built-in templates live with userId = null, isBuiltin = true. They're
 * shared across all users; per-user hiding is handled by UserHiddenTemplate.
 *
 * The seed is the source of truth: on every run, each starter template's
 * exercise list is rebuilt from STARTER_TEMPLATES. Exercises referenced by
 * name that don't exist in SEED_EXERCISES are skipped with a warning, not
 * an error — that way a typo in STARTER_TEMPLATES doesn't fail the whole
 * seed run.
 *
 * No revision history: re-seeding wipes and recreates the TemplateExercise
 * rows. The user explicitly chose this trade-off when scoping the feature.
 */
async function seedStarterTemplates() {
  // Build a name → id lookup once. Only built-in (ownerId: null) exercises
  // are eligible — starter templates can't reference user customs.
  const builtinExercises = await prisma.exercise.findMany({
    where: { ownerId: null, deletedAt: null },
    select: { id: true, name: true },
  });
  const idByName = new Map(builtinExercises.map((e) => [e.name, e.id]));

  let created = 0;
  let updated = 0;
  const missing: string[] = [];

  for (const tpl of STARTER_TEMPLATES) {
    const exerciseIds: string[] = [];
    for (const exName of tpl.exerciseNames) {
      const id = idByName.get(exName);
      if (!id) {
        missing.push(`${tpl.name} → ${exName}`);
        continue;
      }
      exerciseIds.push(id);
    }
    if (exerciseIds.length === 0) {
      console.warn(`Skipping starter template "${tpl.name}" — no exercises resolved.`);
      continue;
    }

    const existing = await prisma.workoutTemplate.findFirst({
      where: { userId: null, isBuiltin: true, name: tpl.name },
    });

    if (existing) {
      // Replace the exercise list from scratch — simpler than a diff and
      // matches the no-revision-history contract.
      await prisma.$transaction([
        prisma.templateExercise.deleteMany({ where: { templateId: existing.id } }),
        prisma.workoutTemplate.update({
          where: { id: existing.id },
          data: {
            description: tpl.description,
            exercises: {
              create: exerciseIds.map((exId, idx) => ({ exerciseId: exId, position: idx })),
            },
          },
        }),
      ]);
      updated++;
    } else {
      await prisma.workoutTemplate.create({
        data: {
          userId: null,
          isBuiltin: true,
          name: tpl.name,
          description: tpl.description,
          exercises: {
            create: exerciseIds.map((exId, idx) => ({ exerciseId: exId, position: idx })),
          },
        },
      });
      created++;
    }
  }

  console.log(`Templates — created: ${created}, updated: ${updated}`);
  if (missing.length > 0) {
    console.warn('Unresolved exercise references in STARTER_TEMPLATES:');
    for (const m of missing) console.warn(`  ${m}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
