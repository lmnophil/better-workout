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
import { MAX_ROUTINE_DAYS } from './routine';

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

const AddExercisesSchema = z.object({
  exerciseIds: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * Add one or more exercises to the user's active session in a single
 * transaction. Used by the multi-select picker. Skips any IDs that are
 * already in the session (no-op for the duplicate subset) and preserves
 * caller-provided order for new additions. Creates the session lazily if
 * none exists.
 */
export const addExercisesToActiveSession = withLogging('addExercisesToActiveSession', async (
  input: z.infer<typeof AddExercisesSchema>,
) => {
  const userId = await requireUser();
  const { exerciseIds } = AddExercisesSchema.parse(input);

  // Verify access for every exercise up front. If any fail, none are added.
  // Fetching them all in one query rather than N round-trips.
  const accessible = await db.exercise.findMany({
    where: {
      id: { in: exerciseIds },
      OR: [{ ownerId: null }, { ownerId: userId }],
      deletedAt: null,
    },
    select: { id: true },
  });
  const accessibleIds = new Set(accessible.map((e) => e.id));
  for (const id of exerciseIds) {
    if (!accessibleIds.has(id)) {
      throw new Error('Exercise not available');
    }
  }

  const session = await getOrCreateActiveSession(userId);

  // Skip any exercises already in the session — preserve no-op semantics from
  // the single-add. Stable order across the not-yet-added subset.
  const existing = await db.setLog.findMany({
    where: { sessionId: session.id, exerciseId: { in: exerciseIds } },
    select: { exerciseId: true },
    distinct: ['exerciseId'],
  });
  const alreadyIn = new Set(existing.map((s) => s.exerciseId));
  const toAdd = exerciseIds.filter((id) => !alreadyIn.has(id));
  if (toAdd.length === 0) {
    revalidatePath('/');
    return;
  }

  const maxPos = await db.setLog.aggregate({
    where: { sessionId: session.id },
    _max: { position: true },
  });
  const startPosition = (maxPos._max.position ?? -1) + 1;

  await db.setLog.createMany({
    data: toAdd.map((exId, idx) => ({
      sessionId: session.id,
      exerciseId: exId,
      setNumber: 1,
      position: startPosition + idx,
      reps: null,
      weight: null,
    })),
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
  // Without this, addSet could be used to bypass addExercisesToActiveSession
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
    revalidatePath('/');
    return;
  }

  await db.workoutSession.update({
    where: { id: session.id },
    data: { completedAt: new Date() },
  });
  metrics.sessionsCompleted.inc();

  // If this session was started from a routine day, advance the routine cursor.
  // Only matters in sequence mode — weekday mode is calendar-driven and ignores
  // the cursor — but we write it unconditionally so a later mode-flip behaves
  // sanely. Defensive: if the day was deleted between start and complete, skip.
  if (session.startedFromRoutineDayId) {
    const day = await db.routineDay.findUnique({
      where: { id: session.startedFromRoutineDayId },
      select: { position: true, routineId: true },
    });
    if (day) {
      await db.routine.update({
        where: { id: day.routineId },
        data: { lastCompletedPosition: day.position },
      });
    }
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

const SwapExerciseSchema = z.object({
  oldExerciseId: z.string().min(1),
  newExerciseId: z.string().min(1),
});

/**
 * Replace one exercise in the active session with another. Preserves the
 * original's position in the order and discards any logged sets for the
 * outgoing exercise — swap is destructive by design (if you wanted to keep
 * the work, you wouldn't be swapping). The incoming exercise gets a single
 * empty SetLog at the same position, ready to log against.
 *
 * Refuses to swap to an exercise already in the session (would create a
 * duplicate at a different position). Same-id no-ops cleanly.
 */
export const swapExerciseInActiveSession = withLogging(
  'swapExerciseInActiveSession',
  async (input: z.infer<typeof SwapExerciseSchema>) => {
    const userId = await requireUser();
    const { oldExerciseId, newExerciseId } = SwapExerciseSchema.parse(input);

    if (oldExerciseId === newExerciseId) return;

    await requireAvailableExercise(userId, newExerciseId);

    const session = await findActiveSession(userId);
    if (!session) throw new Error('No active session');

    // Find the outgoing exercise's position. Any of its sets has the position
    // (they're all equal — position is per-exercise-in-session).
    const sample = await db.setLog.findFirst({
      where: { sessionId: session.id, exerciseId: oldExerciseId },
      select: { position: true },
    });
    if (!sample) throw new Error('Exercise not in active session');

    // Refuse to swap to an exercise the session already has. Letting it
    // through would either create a duplicate at this position or leave the
    // user with a confusingly-deleted other slot.
    const collision = await db.setLog.count({
      where: { sessionId: session.id, exerciseId: newExerciseId },
    });
    if (collision > 0) {
      throw new Error('That exercise is already in this session');
    }

    // Atomic: drop old sets, create the new exercise's seed set at the same
    // position. A failure between the two would leave the user with either
    // a missing slot or an empty one.
    await db.$transaction([
      db.setLog.deleteMany({
        where: { sessionId: session.id, exerciseId: oldExerciseId },
      }),
      db.setLog.create({
        data: {
          sessionId: session.id,
          exerciseId: newExerciseId,
          setNumber: 1,
          position: sample.position,
          reps: null,
          weight: null,
        },
      }),
    ]);

    revalidatePath('/');
  },
);

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

  // Friendly error on name collision against the user's own templates. We
  // intentionally don't check against built-ins — Postgres treats (null, name)
  // and (userId, name) as distinct, and surfacing "you already have a template
  // by that name" when the conflict is with a built-in would be confusing.
  // The user can rename or hide the built-in if they want to.
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
      isBuiltin: false,
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

  // Load the template — either the user's own, or a built-in that they
  // haven't hidden. Built-ins (userId = null, isBuiltin = true) are reachable
  // by anyone unless they've added a UserHiddenTemplate row for it.
  const template = await db.workoutTemplate.findFirst({
    where: {
      id: templateId,
      OR: [
        { userId },
        {
          userId: null,
          isBuiltin: true,
          hiddenBy: { none: { userId } },
        },
      ],
    },
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

/**
 * Delete a user-owned template. Built-ins can't be deleted — use hideTemplate
 * for those. Scope-by-userId acts as the ownership check; if the templateId
 * is a built-in the deleteMany is a no-op (built-in userId is null).
 */
export const deleteTemplate = withLogging('deleteTemplate', async (input: z.infer<typeof DeleteTemplateSchema>) => {
  const userId = await requireUser();
  const { templateId } = DeleteTemplateSchema.parse(input);

  // Pre-check so we can return a meaningful error if the user tries to delete
  // a built-in. The deleteMany below would silently do nothing without this.
  const template = await db.workoutTemplate.findUnique({
    where: { id: templateId },
    select: { userId: true, isBuiltin: true },
  });
  if (template?.isBuiltin) {
    throw new Error('Built-in templates can be hidden but not deleted');
  }

  // Refuse if the template is referenced by a routine day. Cascade would
  // silently drop the day (and its pending swaps), and a user who can't
  // see the connection would be surprised. Make them remove the day first.
  const routineUse = await db.routineDay.count({
    where: { templateId, routine: { userId } },
  });
  if (routineUse > 0) {
    throw new Error(
      "This template is used in your routine. Remove it from the routine first.",
    );
  }

  await db.workoutTemplate.deleteMany({ where: { id: templateId, userId } });

  revalidatePath('/');
});

const HideTemplateSchema = z.object({ templateId: z.string().min(1) });

/**
 * Hide a built-in template from the current user's list. No-op if the
 * template is the user's own (only built-ins are hideable) or already hidden.
 * Idempotent.
 */
export const hideTemplate = withLogging('hideTemplate', async (input: z.infer<typeof HideTemplateSchema>) => {
  const userId = await requireUser();
  const { templateId } = HideTemplateSchema.parse(input);

  const template = await db.workoutTemplate.findUnique({
    where: { id: templateId },
    select: { isBuiltin: true },
  });
  if (!template?.isBuiltin) {
    throw new Error('Only built-in templates can be hidden');
  }

  // upsert pattern via createMany skipDuplicates — cleanly idempotent without
  // a select-then-insert race window.
  await db.userHiddenTemplate.createMany({
    data: [{ userId, templateId }],
    skipDuplicates: true,
  });

  revalidatePath('/');
});

const UnhideTemplateSchema = z.object({ templateId: z.string().min(1) });

export const unhideTemplate = withLogging('unhideTemplate', async (input: z.infer<typeof UnhideTemplateSchema>) => {
  const userId = await requireUser();
  const { templateId } = UnhideTemplateSchema.parse(input);

  await db.userHiddenTemplate.deleteMany({
    where: { userId, templateId },
  });

  revalidatePath('/');
});

// ============================================================
// ROUTINES
// ============================================================
//
// One routine per user (DB-enforced via @unique on Routine.userId). Days are
// thin wrappers around existing templates — picking a template into a day is
// a reference, not a copy, so editing the template propagates everywhere it's
// used. Capped at MAX_ROUTINE_DAYS days to keep the timeline UI bounded.

const ScheduleStyleSchema = z.enum(['sequence', 'weekday']);

async function requireUserTemplate(userId: string, templateId: string) {
  // Ownership-or-built-in check; built-ins (userId null) are reachable to
  // everyone unless hidden, but for routine purposes we don't filter hidden —
  // the user explicitly selected the template, hidden status is about list
  // surfacing.
  const template = await db.workoutTemplate.findFirst({
    where: {
      id: templateId,
      OR: [{ userId }, { userId: null, isBuiltin: true }],
    },
  });
  if (!template) throw new Error('Template not found');
  return template;
}

const CreateRoutineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  scheduleStyle: ScheduleStyleSchema.default('sequence'),
});

/**
 * Create the user's routine. Throws if one already exists — routines are
 * one-per-user and editing the existing one is the natural path. The unique
 * constraint on userId would block the insert anyway; the explicit check
 * surfaces a friendlier message.
 */
export const createRoutine = withLogging('createRoutine', async (
  input: z.infer<typeof CreateRoutineSchema>,
) => {
  const userId = await requireUser();
  const { name, description, scheduleStyle } = CreateRoutineSchema.parse(input);

  const existing = await db.routine.findUnique({ where: { userId } });
  if (existing) {
    throw new Error('You already have a routine. Edit it instead of creating a new one.');
  }

  await db.routine.create({
    data: {
      userId,
      name,
      description: description || null,
      scheduleStyle,
    },
  });

  revalidatePath('/');
  revalidatePath('/settings');
});

const UpdateRoutineSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  scheduleStyle: ScheduleStyleSchema.optional(),
});

/**
 * Edit the routine's metadata. Switching scheduleStyle clears state that
 * doesn't apply to the new mode:
 *   - sequence → weekday: weekday assignments stay null until the user picks
 *     them; lastCompletedPosition is reset to null since it's irrelevant.
 *   - weekday → sequence: weekday assignments are cleared so a future
 *     re-switch starts clean. lastCompletedPosition stays null until the
 *     user completes a routine session.
 */
export const updateRoutine = withLogging('updateRoutine', async (
  input: z.infer<typeof UpdateRoutineSchema>,
) => {
  const userId = await requireUser();
  const data = UpdateRoutineSchema.parse(input);

  const routine = await db.routine.findUnique({ where: { userId } });
  if (!routine) throw new Error('No routine to update');

  await db.$transaction(async (tx) => {
    if (data.scheduleStyle && data.scheduleStyle !== routine.scheduleStyle) {
      // Mode change: reset lastCompletedPosition and clear weekday pins.
      await tx.routineDay.updateMany({
        where: { routineId: routine.id },
        data: { weekday: null },
      });
    }
    await tx.routine.update({
      where: { id: routine.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description || null }
          : {}),
        ...(data.scheduleStyle !== undefined
          ? {
              scheduleStyle: data.scheduleStyle,
              lastCompletedPosition: null,
            }
          : {}),
      },
    });
  });

  revalidatePath('/');
  revalidatePath('/settings');
});

export const deleteRoutine = withLogging('deleteRoutine', async () => {
  const userId = await requireUser();
  // Cascade handles RoutineDay → RoutineDayPendingSwap.
  // Sessions that referenced any of these days lose their FK (SetNull) but
  // remain in history.
  await db.routine.deleteMany({ where: { userId } });
  revalidatePath('/');
  revalidatePath('/settings');
});

const AddRoutineDaySchema = z.object({
  templateId: z.string().min(1),
  label: z.string().trim().max(60).optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
});

/**
 * Append a day to the routine. New day's position = current count
 * (0-indexed, contiguous). For weekday mode, weekday must be in 0..6 and
 * not already pinned — the unique constraint enforces; we pre-check for a
 * friendly error. For sequence mode, weekday is silently ignored (stored
 * as null even if provided).
 */
export const addRoutineDay = withLogging('addRoutineDay', async (
  input: z.infer<typeof AddRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { templateId, label, weekday } = AddRoutineDaySchema.parse(input);

  const routine = await db.routine.findUnique({
    where: { userId },
    include: { _count: { select: { days: true } } },
  });
  if (!routine) throw new Error('No routine — create one first');

  if (routine._count.days >= MAX_ROUTINE_DAYS) {
    throw new Error(`A routine can have at most ${MAX_ROUTINE_DAYS} days.`);
  }

  await requireUserTemplate(userId, templateId);

  const effectiveWeekday = routine.scheduleStyle === 'weekday' && weekday != null ? weekday : null;
  if (effectiveWeekday !== null) {
    const collision = await db.routineDay.findFirst({
      where: { routineId: routine.id, weekday: effectiveWeekday },
      select: { id: true },
    });
    if (collision) {
      throw new Error('That weekday is already taken in your routine.');
    }
  }

  await db.routineDay.create({
    data: {
      routineId: routine.id,
      templateId,
      position: routine._count.days,
      weekday: effectiveWeekday,
      label: label || null,
    },
  });

  revalidatePath('/');
  revalidatePath('/settings');
});

const UpdateRoutineDaySchema = z.object({
  routineDayId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  label: z.string().trim().max(60).nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
});

export const updateRoutineDay = withLogging('updateRoutineDay', async (
  input: z.infer<typeof UpdateRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, templateId, label, weekday } = UpdateRoutineDaySchema.parse(input);

  // Ownership: walk through routine
  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: { routine: { select: { id: true, scheduleStyle: true } } },
  });
  if (!day) throw new Error('Routine day not found');

  if (templateId !== undefined) {
    await requireUserTemplate(userId, templateId);
  }

  // Weekday update only meaningful in weekday mode; ignore in sequence mode
  // so a stale client can't introduce inconsistent state.
  let effectiveWeekday: number | null | undefined = undefined;
  if (weekday !== undefined) {
    if (day.routine.scheduleStyle !== 'weekday') {
      effectiveWeekday = null;
    } else if (weekday !== null) {
      const collision = await db.routineDay.findFirst({
        where: {
          routineId: day.routine.id,
          weekday: weekday,
          NOT: { id: routineDayId },
        },
        select: { id: true },
      });
      if (collision) {
        throw new Error('That weekday is already taken in your routine.');
      }
      effectiveWeekday = weekday;
    } else {
      effectiveWeekday = null;
    }
  }

  await db.routineDay.update({
    where: { id: routineDayId },
    data: {
      ...(templateId !== undefined ? { templateId } : {}),
      ...(label !== undefined ? { label: label || null } : {}),
      ...(effectiveWeekday !== undefined ? { weekday: effectiveWeekday } : {}),
    },
  });

  revalidatePath('/');
  revalidatePath('/settings');
});

const RemoveRoutineDaySchema = z.object({ routineDayId: z.string().min(1) });

/**
 * Delete a routine day and renumber remaining days so positions stay
 * contiguous from 0. Sessions that referenced this day stay (SetNull on the
 * FK), preserving history. Pending swaps cascade with the day.
 *
 * If the deleted day's position was at or below lastCompletedPosition, we
 * need to adjust the cursor — otherwise the next "today's day" calculation
 * could skip a position. Simplest correct fix: if cursor was past the
 * deleted day, decrement it.
 */
export const removeRoutineDay = withLogging('removeRoutineDay', async (
  input: z.infer<typeof RemoveRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { routineDayId } = RemoveRoutineDaySchema.parse(input);

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: {
      routine: { select: { id: true, lastCompletedPosition: true } },
    },
  });
  if (!day) throw new Error('Routine day not found');

  await db.$transaction(async (tx) => {
    await tx.routineDay.delete({ where: { id: routineDayId } });

    // Renumber: any day with position > the removed one shifts down by 1.
    const remaining = await tx.routineDay.findMany({
      where: { routineId: day.routine.id },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i) {
        await tx.routineDay.update({
          where: { id: remaining[i].id },
          data: { position: i },
        });
      }
    }

    // Cursor adjustment: if cursor was at or beyond the removed position,
    // decrement (clamped at -1, which we represent as null).
    const cursor = day.routine.lastCompletedPosition;
    if (cursor !== null && cursor >= day.position) {
      const newCursor = cursor - 1;
      await tx.routine.update({
        where: { id: day.routine.id },
        data: { lastCompletedPosition: newCursor < 0 ? null : newCursor },
      });
    }
  });

  revalidatePath('/');
  revalidatePath('/settings');
});

const ReorderRoutineDaySchema = z.object({
  routineDayId: z.string().min(1),
  direction: z.enum(['up', 'down']),
});

/**
 * Move a routine day up or down — swaps positions with the adjacent day.
 * Position is the unique key (routineId, position) so the swap goes through
 * an intermediate sentinel value to avoid colliding mid-update.
 */
export const reorderRoutineDay = withLogging('reorderRoutineDay', async (
  input: z.infer<typeof ReorderRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, direction } = ReorderRoutineDaySchema.parse(input);

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
  });
  if (!day) throw new Error('Routine day not found');

  const days = await db.routineDay.findMany({
    where: { routineId: day.routineId },
    orderBy: { position: 'asc' },
    select: { id: true, position: true },
  });
  const myIndex = days.findIndex((d) => d.id === routineDayId);
  const neighborIndex = direction === 'up' ? myIndex - 1 : myIndex + 1;
  if (neighborIndex < 0 || neighborIndex >= days.length) return; // edge

  const me = days[myIndex];
  const neighbor = days[neighborIndex];
  // Move via a sentinel position to dodge the unique constraint.
  const sentinel = -1;

  await db.$transaction([
    db.routineDay.update({
      where: { id: me.id },
      data: { position: sentinel },
    }),
    db.routineDay.update({
      where: { id: neighbor.id },
      data: { position: me.position },
    }),
    db.routineDay.update({
      where: { id: me.id },
      data: { position: neighbor.position },
    }),
  ]);

  revalidatePath('/');
  revalidatePath('/settings');
});

const SetPendingSwapSchema = z.object({
  routineDayId: z.string().min(1),
  outExerciseId: z.string().min(1),
  inExerciseId: z.string().min(1),
});

/**
 * Stage a one-time exercise substitution on a routine day. Applied (and
 * cleared) when the day's session is started. Persists across calendar days
 * — the user can stage a swap days in advance.
 *
 * Validates: the day belongs to the user, the outgoing exercise is actually
 * in the day's template, and the incoming exercise is one the user can use.
 * Idempotent: re-staging the same (out → new) replaces any existing swap
 * for that out exercise.
 */
export const setPendingSwap = withLogging('setPendingSwap', async (
  input: z.infer<typeof SetPendingSwapSchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, outExerciseId, inExerciseId } = SetPendingSwapSchema.parse(input);

  if (outExerciseId === inExerciseId) {
    // No-op; treat as remove-existing for self-consistency.
    await db.routineDayPendingSwap.deleteMany({
      where: { routineDayId, outExerciseId, routineDay: { routine: { userId } } },
    });
    revalidatePath('/');
    return;
  }

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: {
      template: {
        include: {
          exercises: { select: { exerciseId: true } },
        },
      },
    },
  });
  if (!day) throw new Error('Routine day not found');

  const templateExerciseIds = new Set(day.template.exercises.map((te) => te.exerciseId));
  if (!templateExerciseIds.has(outExerciseId)) {
    throw new Error("That exercise isn't in this day's template.");
  }
  if (templateExerciseIds.has(inExerciseId)) {
    throw new Error('That exercise is already in this day.');
  }

  await requireAvailableExercise(userId, inExerciseId);

  await db.routineDayPendingSwap.upsert({
    where: {
      routineDayId_outExerciseId: { routineDayId, outExerciseId },
    },
    create: { routineDayId, outExerciseId, inExerciseId },
    update: { inExerciseId },
  });

  revalidatePath('/');
});

const ClearPendingSwapSchema = z.object({
  routineDayId: z.string().min(1),
  outExerciseId: z.string().min(1),
});

export const clearPendingSwap = withLogging('clearPendingSwap', async (
  input: z.infer<typeof ClearPendingSwapSchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, outExerciseId } = ClearPendingSwapSchema.parse(input);

  await db.routineDayPendingSwap.deleteMany({
    where: {
      routineDayId,
      outExerciseId,
      routineDay: { routine: { userId } },
    },
  });

  revalidatePath('/');
});

const SwapInRoutineTemplateSchema = z.object({
  routineDayId: z.string().min(1),
  outExerciseId: z.string().min(1),
  inExerciseId: z.string().min(1),
});

/**
 * Permanent swap: edit the template the routine day points at, replacing
 * `outExerciseId` with `inExerciseId` at the same position. Affects every
 * future use of the template (in this routine day or anywhere else it's
 * referenced).
 *
 * Refuses to modify built-in templates — they're shared across users. The
 * user-facing message tells them how to fork manually (build a new template
 * from scratch). Auto-forking on built-ins is an obvious next step but
 * deliberately deferred to keep this action focused.
 */
export const swapInRoutineTemplate = withLogging('swapInRoutineTemplate', async (
  input: z.infer<typeof SwapInRoutineTemplateSchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, outExerciseId, inExerciseId } = SwapInRoutineTemplateSchema.parse(input);

  if (outExerciseId === inExerciseId) return;

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: { template: { select: { id: true, isBuiltin: true, userId: true } } },
  });
  if (!day) throw new Error('Routine day not found');

  if (day.template.isBuiltin || day.template.userId === null) {
    throw new Error(
      'This day uses a default template, which can’t be edited directly. Build your own copy first.',
    );
  }

  await requireAvailableExercise(userId, inExerciseId);

  const targetEntry = await db.templateExercise.findFirst({
    where: { templateId: day.template.id, exerciseId: outExerciseId },
  });
  if (!targetEntry) {
    throw new Error("That exercise isn't in the template anymore.");
  }

  // Refuse if the new exercise is already in the template — would violate
  // the (templateId, exerciseId) unique constraint and is probably user error.
  const collision = await db.templateExercise.findFirst({
    where: { templateId: day.template.id, exerciseId: inExerciseId },
    select: { id: true },
  });
  if (collision) {
    throw new Error('That exercise is already in the template.');
  }

  await db.$transaction([
    db.templateExercise.update({
      where: { id: targetEntry.id },
      data: { exerciseId: inExerciseId },
    }),
    // If a one-time pending swap was staged for the outgoing exercise, drop
    // it — the permanent change supersedes any pending one-shot.
    db.routineDayPendingSwap.deleteMany({
      where: { routineDayId, outExerciseId },
    }),
  ]);

  revalidatePath('/');
  revalidatePath('/settings');
});

const StartFromRoutineDaySchema = z.object({
  routineDayId: z.string().min(1),
});

/**
 * Begin a fresh active session populated from a routine day's template, with
 * any pending one-time swaps applied during population. Marks the new
 * session with startedFromRoutineDayId so completing it can advance the
 * routine cursor (sequence mode).
 *
 * Refuses if there's already an active session — mirrors startFromTemplate.
 * After population, all pending swaps for this day are cleared.
 */
export const startFromRoutineDay = withLogging('startFromRoutineDay', async (
  input: z.infer<typeof StartFromRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { routineDayId } = StartFromRoutineDaySchema.parse(input);

  const existing = await findActiveSession(userId);
  if (existing) {
    throw new Error(
      'You already have a workout in progress. Complete or discard it first.',
    );
  }

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: {
      template: {
        include: {
          exercises: {
            orderBy: { position: 'asc' },
            include: {
              exercise: {
                select: { id: true, deletedAt: true, ownerId: true },
              },
            },
          },
        },
      },
      pendingSwaps: {
        include: {
          inExercise: {
            select: { id: true, deletedAt: true, ownerId: true },
          },
        },
      },
    },
  });
  if (!day) throw new Error('Routine day not found');

  const swapsByOutId = new Map(
    day.pendingSwaps
      .filter((s) => {
        const ex = s.inExercise;
        if (ex.deletedAt !== null) return false;
        if (ex.ownerId !== null && ex.ownerId !== userId) return false;
        return true;
      })
      .map((s) => [s.outExerciseId, s.inExerciseId]),
  );

  // Walk template exercises, substitute via pending swaps, drop unusable.
  const lineup: string[] = [];
  for (const te of day.template.exercises) {
    const ex = te.exercise;
    const replacement = swapsByOutId.get(te.exerciseId);
    if (replacement !== undefined) {
      lineup.push(replacement);
    } else if (ex.deletedAt === null && (ex.ownerId === null || ex.ownerId === userId)) {
      lineup.push(te.exerciseId);
    }
  }

  if (lineup.length === 0) {
    throw new Error('This day has no usable exercises right now.');
  }

  await db.$transaction(async (tx) => {
    const newSession = await tx.workoutSession.create({
      data: {
        userId,
        date: new Date(),
        startedFromRoutineDayId: day.id,
      },
    });
    await tx.setLog.createMany({
      data: lineup.map((exerciseId, idx) => ({
        sessionId: newSession.id,
        exerciseId,
        setNumber: 1,
        position: idx,
        reps: null,
        weight: null,
      })),
    });
    // Pending swaps consumed.
    await tx.routineDayPendingSwap.deleteMany({
      where: { routineDayId: day.id },
    });
  });

  metrics.templatesUsed.inc();
  revalidatePath('/');
});
