'use server';

// Server actions for the workout tracker.
//
// Conventions:
//   - Every action calls auth() to get the user; never trust client-provided userId
//   - Every mutation that touches a session/exercise verifies ownership
//   - Every action calls revalidatePath('/') so the page re-renders with fresh data
//   - Inputs are validated with Zod where they cross the trust boundary

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withLogging } from './observability';
import { metrics } from './metrics';

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session.user.id;
}

/**
 * Find the user's active (in-progress) session. Returns the most recent one if
 * — by some bug or race — multiple exist. App convention is at most one, but
 * defensive ordering means we always pick deterministically.
 */
async function findActiveSession(userId: string) {
  return db.workoutSession.findFirst({
    where: { userId, completedAt: null },
    orderBy: { date: 'desc' },
  });
}

/**
 * Verify an exercise is one the user can use (built-in or their own custom,
 * not soft-deleted). Throws if not. Returns the exercise on success.
 */
async function requireAvailableExercise(userId: string, exerciseId: string) {
  const exercise = await db.exercise.findFirst({
    where: {
      id: exerciseId,
      OR: [{ ownerId: null }, { ownerId: userId }],
      deletedAt: null,
    },
  });
  if (!exercise) throw new Error('Exercise not available');
  return exercise;
}

/**
 * Get the user's active session, creating one if none exists.
 * Called lazily when the user adds their first exercise.
 */
async function getOrCreateActiveSession(userId: string) {
  const existing = await findActiveSession(userId);
  if (existing) return existing;
  return db.workoutSession.create({
    data: { userId, date: new Date() },
  });
}

// ============================================================
// SESSION ACTIONS
// ============================================================

const AddExerciseSchema = z.object({ exerciseId: z.string().min(1) });

export const addExerciseToActiveSession = withLogging('addExerciseToActiveSession', async (input: z.infer<typeof AddExerciseSchema>) => {
  const userId = await requireUser();
  const { exerciseId } = AddExerciseSchema.parse(input);

  await requireAvailableExercise(userId, exerciseId);

  const session = await getOrCreateActiveSession(userId);

  // Don't add duplicate exercise to the same session — if it's already there, no-op
  const existingSet = await db.setLog.findFirst({
    where: { sessionId: session.id, exerciseId },
  });
  if (existingSet) {
    revalidatePath('/');
    return;
  }

  // Place the new exercise at the end of the session's order
  const maxPos = await db.setLog.aggregate({
    where: { sessionId: session.id },
    _max: { position: true },
  });
  const nextPosition = (maxPos._max.position ?? -1) + 1;

  // Add an empty first set
  await db.setLog.create({
    data: {
      sessionId: session.id,
      exerciseId,
      setNumber: 1,
      position: nextPosition,
      reps: null,
      weight: null,
    },
  });

  revalidatePath('/');
});

const RemoveExerciseSchema = z.object({ exerciseId: z.string().min(1) });

export const removeExerciseFromActiveSession = withLogging('removeExerciseFromActiveSession', async (
  input: z.infer<typeof RemoveExerciseSchema>,
) => {
  const userId = await requireUser();
  const { exerciseId } = RemoveExerciseSchema.parse(input);

  const session = await findActiveSession(userId);
  if (!session) return;

  await db.setLog.deleteMany({
    where: { sessionId: session.id, exerciseId },
  });

  // If that was the last exercise in the session, delete the session itself.
  // Otherwise an empty session would persist and confuse "active" detection
  // on later visits.
  const remaining = await db.setLog.count({ where: { sessionId: session.id } });
  if (remaining === 0) {
    await db.workoutSession.delete({ where: { id: session.id } });
  }

  revalidatePath('/');
});

// ============================================================
// SET ACTIONS
// ============================================================

const AddSetSchema = z.object({ exerciseId: z.string().min(1) });

export const addSet = withLogging('addSet', async (input: z.infer<typeof AddSetSchema>) => {
  const userId = await requireUser();
  const { exerciseId } = AddSetSchema.parse(input);

  // SECURITY: verify the user actually has access to this exercise.
  // Without this, addSet could be used to bypass addExerciseToActiveSession
  // and create SetLogs referencing other users' custom exercises.
  await requireAvailableExercise(userId, exerciseId);

  const session = await findActiveSession(userId);
  if (!session) throw new Error('No active session');

  // Find the highest setNumber for this exercise in this session. The exercise
  // MUST already be in the session — addSet is for adding more sets to an
  // existing exercise, not for adding new exercises. Without this guard, a
  // stale client (or a race with removeExerciseFromActiveSession) could create
  // an orphan SetLog at position 0 that breaks ordering elsewhere.
  const lastSet = await db.setLog.findFirst({
    where: { sessionId: session.id, exerciseId },
    orderBy: { setNumber: 'desc' },
  });
  if (!lastSet) {
    throw new Error('Exercise not in active session');
  }

  await db.setLog.create({
    data: {
      sessionId: session.id,
      exerciseId,
      setNumber: lastSet.setNumber + 1,
      // Inherit the exercise's existing position so all sets stay grouped
      position: lastSet.position,
      // Pre-fill from the previous set so progressive overload is one tap away
      reps: lastSet.reps,
      weight: lastSet.weight,
    },
  });

  metrics.setsLogged.inc();
  revalidatePath('/');
});

const UpdateSetSchema = z.object({
  setLogId: z.string().min(1),
  reps: z.number().int().min(0).max(1000).nullable(),
  weight: z.number().min(0).max(10000).nullable(),
});

export const updateSet = withLogging('updateSet', async (input: z.infer<typeof UpdateSetSchema>) => {
  const userId = await requireUser();
  const { setLogId, reps, weight } = UpdateSetSchema.parse(input);

  // Verify the set belongs to a session owned by this user
  const setLog = await db.setLog.findUnique({
    where: { id: setLogId },
    include: { session: true },
  });
  if (!setLog || setLog.session.userId !== userId) {
    throw new Error('Set not found');
  }
  if (setLog.session.completedAt) {
    throw new Error('Cannot edit a completed session');
  }

  await db.setLog.update({
    where: { id: setLogId },
    data: { reps, weight },
  });

  revalidatePath('/');
});

const RemoveSetSchema = z.object({ setLogId: z.string().min(1) });

export const removeSet = withLogging('removeSet', async (input: z.infer<typeof RemoveSetSchema>) => {
  const userId = await requireUser();
  const { setLogId } = RemoveSetSchema.parse(input);

  const setLog = await db.setLog.findUnique({
    where: { id: setLogId },
    include: { session: true },
  });
  if (!setLog || setLog.session.userId !== userId) {
    throw new Error('Set not found');
  }
  if (setLog.session.completedAt) {
    throw new Error('Cannot edit a completed session');
  }

  // Delete + renumber in one transaction. Either both happen or neither does;
  // a partial failure mid-renumber would leave gaps in setNumber.
  await db.$transaction(async (tx) => {
    await tx.setLog.delete({ where: { id: setLogId } });

    const remaining = await tx.setLog.findMany({
      where: { sessionId: setLog.sessionId, exerciseId: setLog.exerciseId },
      orderBy: { setNumber: 'asc' },
    });
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      if (s.setNumber !== i + 1) {
        await tx.setLog.update({
          where: { id: s.id },
          data: { setNumber: i + 1 },
        });
      }
    }
  });

  // If the session has no sets left at all, clean it up — same reason as
  // removeExerciseFromActiveSession. Outside the transaction so the renumber
  // is durable even if this cleanup fails.
  const remainingInSession = await db.setLog.count({
    where: { sessionId: setLog.sessionId },
  });
  if (remainingInSession === 0) {
    await db.workoutSession.delete({ where: { id: setLog.sessionId } });
  }

  revalidatePath('/');
});

// ============================================================
// SESSION COMPLETION / ABANDON
// ============================================================

export const completeActiveSession = withLogging('completeActiveSession', async () => {
  const userId = await requireUser();
  const session = await findActiveSession(userId);
  if (!session) return;

  // Don't allow completing an empty session
  const setCount = await db.setLog.count({ where: { sessionId: session.id } });
  if (setCount === 0) {
    await db.workoutSession.delete({ where: { id: session.id } });
  } else {
    await db.workoutSession.update({
      where: { id: session.id },
      data: { completedAt: new Date() },
    });
    metrics.sessionsCompleted.inc();
  }
  revalidatePath('/');
});

export const discardActiveSession = withLogging('discardActiveSession', async () => {
  const userId = await requireUser();
  await db.workoutSession.deleteMany({
    where: { userId, completedAt: null },
  });
  revalidatePath('/');
});

const ReorderSchema = z.object({
  exerciseId: z.string().min(1),
  direction: z.enum(['up', 'down']),
});

/**
 * Move an exercise up or down in the session order. Swaps position values with
 * the adjacent exercise. No-op if already at the edge (caller should hide the
 * arrow in that case anyway).
 */
export const reorderExercise = withLogging('reorderExercise', async (input: z.infer<typeof ReorderSchema>) => {
  const userId = await requireUser();
  const { exerciseId, direction } = ReorderSchema.parse(input);

  const session = await findActiveSession(userId);
  if (!session) return;

  // Get distinct exercises with their positions, ordered as they appear on screen
  const ordered = await db.setLog.findMany({
    where: { sessionId: session.id },
    select: { exerciseId: true, position: true },
    distinct: ['exerciseId'],
    orderBy: { position: 'asc' },
  });

  const myIndex = ordered.findIndex((e) => e.exerciseId === exerciseId);
  if (myIndex === -1) return;

  const neighborIndex = direction === 'up' ? myIndex - 1 : myIndex + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) return; // edge — no-op

  const me = ordered[myIndex];
  const neighbor = ordered[neighborIndex];

  // Swap position values atomically. Both updateMany calls in one transaction
  // so observers never see two exercises with the same position.
  await db.$transaction([
    db.setLog.updateMany({
      where: { sessionId: session.id, exerciseId: me.exerciseId },
      data: { position: neighbor.position },
    }),
    db.setLog.updateMany({
      where: { sessionId: session.id, exerciseId: neighbor.exerciseId },
      data: { position: me.position },
    }),
  ]);

  revalidatePath('/');
});

// ============================================================
// CUSTOM EXERCISE ACTIONS
// ============================================================

const CreateCustomExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  primaryMuscles: z.array(z.string()).min(1).max(20),
  secondaryMuscles: z.array(z.string()).max(20).optional(),
  prescription: z.string().trim().max(200).optional(),
  videoUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Optional per-exercise rest override. Stored on ExerciseUserSettings, not Exercise.
  restTimerSeconds: z.number().int().min(5).max(600).optional(),
});

export const createCustomExercise = withLogging('createCustomExercise', async (
  input: z.infer<typeof CreateCustomExerciseSchema>,
) => {
  const userId = await requireUser();
  const {
    name,
    primaryMuscles,
    secondaryMuscles,
    prescription,
    videoUrl,
    restTimerSeconds,
  } = CreateCustomExerciseSchema.parse(input);

  // Check for collision with the user's existing customs
  const existing = await db.exercise.findFirst({
    where: { ownerId: userId, name, deletedAt: null },
  });
  if (existing) {
    throw new Error('You already have an exercise with that name');
  }

  // Create exercise + (optionally) per-exercise settings in one transaction so
  // a settings write failure doesn't leave the exercise without its rest override.
  await db.$transaction(async (tx) => {
    const created = await tx.exercise.create({
      data: {
        name,
        module: 'Custom',
        prescription: prescription || null,
        primaryMuscles,
        secondaryMuscles: secondaryMuscles ?? [],
        videoUrl: videoUrl ?? null,
        isCustom: true,
        ownerId: userId,
      },
    });

    if (restTimerSeconds !== undefined) {
      await tx.exerciseUserSettings.create({
        data: { userId, exerciseId: created.id, restTimerSeconds },
      });
    }
  });

  revalidatePath('/');
});

const DeleteCustomExerciseSchema = z.object({ exerciseId: z.string().min(1) });

export const deleteCustomExercise = withLogging('deleteCustomExercise', async (
  input: z.infer<typeof DeleteCustomExerciseSchema>,
) => {
  const userId = await requireUser();
  const { exerciseId } = DeleteCustomExerciseSchema.parse(input);

  // Soft-delete only — preserves historical SetLogs that reference this exercise
  const exercise = await db.exercise.findFirst({
    where: { id: exerciseId, ownerId: userId },
  });
  if (!exercise) throw new Error('Exercise not found');

  await db.exercise.update({
    where: { id: exerciseId },
    data: { deletedAt: new Date() },
  });

  revalidatePath('/');
});

// ============================================================
// VOLUME TARGET SETTINGS
// ============================================================

const SetVolumeTargetSchema = z.object({
  muscleId: z.string().min(1),
  target: z.number().int().min(0).max(50),
});

export const setVolumeTarget = withLogging('setVolumeTarget', async (input: z.infer<typeof SetVolumeTargetSchema>) => {
  const userId = await requireUser();
  const { muscleId, target } = SetVolumeTargetSchema.parse(input);

  await db.userVolumeTarget.upsert({
    where: { userId_muscleId: { userId, muscleId } },
    create: { userId, muscleId, target },
    update: { target },
  });

  revalidatePath('/coverage');
  revalidatePath('/settings');
});

const ResetVolumeTargetSchema = z.object({ muscleId: z.string().min(1) });

export const resetVolumeTarget = withLogging('resetVolumeTarget', async (input: z.infer<typeof ResetVolumeTargetSchema>) => {
  const userId = await requireUser();
  const { muscleId } = ResetVolumeTargetSchema.parse(input);

  await db.userVolumeTarget.deleteMany({ where: { userId, muscleId } });

  revalidatePath('/coverage');
  revalidatePath('/settings');
});

// ============================================================
// USER PREFERENCES
// ============================================================

const UpdatePreferencesSchema = z.object({
  restTimerEnabled: z.boolean().optional(),
  restTimerSeconds: z.number().int().min(0).max(600).optional(),
  restTimerSound: z.boolean().optional(),
  restTimerVibrate: z.boolean().optional(),
});

/**
 * Partial update to user preferences. Lazily creates the preferences row on
 * first call. Only fields included in `input` are changed.
 */
export const updateUserPreferences = withLogging('updateUserPreferences', async (
  input: z.infer<typeof UpdatePreferencesSchema>,
) => {
  const userId = await requireUser();
  const data = UpdatePreferencesSchema.parse(input);

  await db.userPreferences.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  revalidatePath('/');
  revalidatePath('/settings');
});

// ============================================================
// PER-EXERCISE SETTINGS
// ============================================================

const SetExerciseRestOverrideSchema = z.object({
  exerciseId: z.string().min(1),
  // null = clear the override (fall back to global). Otherwise 5-600 seconds.
  restTimerSeconds: z.number().int().min(5).max(600).nullable(),
});

/**
 * Set or clear the per-exercise rest timer override for the current user.
 * Works for both built-in and custom exercises. Verifies the user can see the
 * exercise (own custom OR built-in) before writing.
 */
export const setExerciseRestOverride = withLogging('setExerciseRestOverride', async (
  input: z.infer<typeof SetExerciseRestOverrideSchema>,
) => {
  const userId = await requireUser();
  const { exerciseId, restTimerSeconds } = SetExerciseRestOverrideSchema.parse(input);

  // Make sure this exercise is one the user can configure (built-in or their own)
  const exercise = await db.exercise.findFirst({
    where: {
      id: exerciseId,
      OR: [{ ownerId: null }, { ownerId: userId }],
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!exercise) throw new Error('Exercise not found');

  if (restTimerSeconds === null) {
    // Clearing — delete the row entirely
    await db.exerciseUserSettings.deleteMany({ where: { userId, exerciseId } });
  } else {
    await db.exerciseUserSettings.upsert({
      where: { userId_exerciseId: { userId, exerciseId } },
      create: { userId, exerciseId, restTimerSeconds },
      update: { restTimerSeconds },
    });
  }

  revalidatePath('/');
});

// ============================================================
// SET NOTES
// ============================================================

const UpdateSetNotesSchema = z.object({
  setLogId: z.string().min(1),
  // Empty string is treated as "clear notes" (stored as null).
  notes: z.string().max(500),
});

/**
 * Update the freeform notes field on a single SetLog. Useful for capturing
 * RPE, form cues, "felt heavy", or anything contextual about that set.
 * Notes are visible the next time you encounter the exercise via the
 * "last time" reference.
 */
export const updateSetNotes = withLogging('updateSetNotes', async (input: z.infer<typeof UpdateSetNotesSchema>) => {
  const userId = await requireUser();
  const { setLogId, notes } = UpdateSetNotesSchema.parse(input);

  // Ownership check — set must belong to a session owned by the user
  const setLog = await db.setLog.findFirst({
    where: { id: setLogId, session: { userId } },
    select: { id: true },
  });
  if (!setLog) throw new Error('Set not found');

  const trimmed = notes.trim();
  await db.setLog.update({
    where: { id: setLogId },
    data: { notes: trimmed.length > 0 ? trimmed : null },
  });

  revalidatePath('/');
});

// ============================================================
// WORKOUT TEMPLATES
// ============================================================

const SaveActiveAsTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
});

/**
 * Snapshot the current active session's exercise list as a named template.
 * Captures only the exercises and their order — not the logged sets, not the
 * weights/reps. The name is unique per user, and we throw a friendly error if
 * the user already has a template by that name.
 */
export const saveActiveAsTemplate = withLogging('saveActiveAsTemplate', async (
  input: z.infer<typeof SaveActiveAsTemplateSchema>,
) => {
  const userId = await requireUser();
  const { name, description } = SaveActiveAsTemplateSchema.parse(input);

  const session = await findActiveSession(userId);
  if (!session) throw new Error('No active session to save');

  // Distinct exercises in order (same logic as workout view)
  const sets = await db.setLog.findMany({
    where: { sessionId: session.id },
    select: { exerciseId: true, position: true },
    distinct: ['exerciseId'],
    orderBy: { position: 'asc' },
  });
  if (sets.length === 0) {
    throw new Error('Add at least one exercise before saving as a template');
  }

  // Friendly error on name collision
  const collision = await db.workoutTemplate.findFirst({
    where: { userId, name },
    select: { id: true },
  });
  if (collision) {
    throw new Error('You already have a template by that name');
  }

  await db.workoutTemplate.create({
    data: {
      userId,
      name,
      description: description || null,
      exercises: {
        create: sets.map((s, idx) => ({
          exerciseId: s.exerciseId,
          position: idx,
        })),
      },
    },
  });

  revalidatePath('/');
});

const StartFromTemplateSchema = z.object({ templateId: z.string().min(1) });

/**
 * Create a fresh active session populated with empty SetLogs from the template.
 * Refuses to run if the user already has an active session — keeps the model
 * simple (one in-progress session at a time). User must complete or discard
 * the current one first.
 *
 * If the template references exercises the user no longer has access to (own
 * custom soft-deleted, or somehow removed), those entries are silently skipped.
 */
export const startFromTemplate = withLogging('startFromTemplate', async (input: z.infer<typeof StartFromTemplateSchema>) => {
  const userId = await requireUser();
  const { templateId } = StartFromTemplateSchema.parse(input);

  // Block if there's already an active session
  const existing = await findActiveSession(userId);
  if (existing) {
    throw new Error(
      'You already have a workout in progress. Complete or discard it first.',
    );
  }

  // Load the template (and verify ownership)
  const template = await db.workoutTemplate.findFirst({
    where: { id: templateId, userId },
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: {
          exercise: { select: { id: true, deletedAt: true, ownerId: true } },
        },
      },
    },
  });
  if (!template) throw new Error('Template not found');

  // Filter to exercises the user can still use
  const usable = template.exercises.filter((te) => {
    const ex = te.exercise;
    if (ex.deletedAt !== null) return false;
    if (ex.ownerId !== null && ex.ownerId !== userId) return false;
    return true;
  });
  if (usable.length === 0) {
    throw new Error('This template no longer has any usable exercises');
  }

  // Create the session and seed empty SetLogs in one transaction
  await db.$transaction(async (tx) => {
    const newSession = await tx.workoutSession.create({
      data: { userId, date: new Date() },
    });
    await tx.setLog.createMany({
      data: usable.map((te, idx) => ({
        sessionId: newSession.id,
        exerciseId: te.exerciseId,
        setNumber: 1,
        position: idx,
        reps: null,
        weight: null,
      })),
    });
  });

  metrics.templatesUsed.inc();
  revalidatePath('/');
});

const DeleteTemplateSchema = z.object({ templateId: z.string().min(1) });

export const deleteTemplate = withLogging('deleteTemplate', async (input: z.infer<typeof DeleteTemplateSchema>) => {
  const userId = await requireUser();
  const { templateId } = DeleteTemplateSchema.parse(input);

  // Scope-by-userId acts as the ownership check — deleteMany is a no-op if it doesn't match
  await db.workoutTemplate.deleteMany({ where: { id: templateId, userId } });

  revalidatePath('/');
});
