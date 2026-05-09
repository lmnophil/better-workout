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
import { PREFS_DEFAULTS } from './prefs';
import { parsePrescriptionSetCount } from './prescription';
import { getLastSetsForExerciseIds } from './queries';

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

/**
 * Build the seed SetLog rows for a list of exercises being added to a session.
 *
 * Set-count source order (history wins because it represents what the user
 * actually does, not what was planned):
 *   1. Most recent completed session for that exercise (180-day window)
 *   2. The optional `plannedSets` hint from the source TemplateExercise
 *   3. Leading "N×" in the Exercise.prescription string ("3×12" → 3)
 *   4. The user's `defaultSetsPerExercise` preference
 *
 * Per-set values: history wins (set 1 from last-time's set 1, etc., with the
 * final set repeated to fill any extra slots so progressive-overload typing is
 * one tap away). With no history, fall back to the planning hints: plannedReps
 * for metric='reps' exercises, plannedSeconds for metric='time' exercises.
 *
 * Weight always comes from history (or null) — planned weight isn't a thing.
 * For metric='time' exercises, the seeded reps are null and seconds carries
 * the planned hint.
 *
 * The optional `hints` map (keyed by exerciseId) carries plannedSets/plannedReps/
 * plannedSeconds from the source TemplateExercise. Callers that don't have a
 * template (e.g. picker-driven adds) just omit it.
 *
 * Returns rows ready for createMany; setNumber is 1-indexed and contiguous.
 */
async function buildSeededSetLogRows(
  userId: string,
  entries: { exerciseId: string; sessionId: string; position: number }[],
  excludeSessionId?: string,
  hints?: Map<
    string,
    { plannedSets: number | null; plannedReps: number | null; plannedSeconds: number | null }
  >,
) {
  if (entries.length === 0) return [];

  const exerciseIds = entries.map((e) => e.exerciseId);

  const [lastByExercise, exercisesMeta, prefRow] = await Promise.all([
    getLastSetsForExerciseIds(userId, exerciseIds, excludeSessionId),
    db.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, prescription: true, metric: true },
    }),
    db.userPreferences.findUnique({
      where: { userId },
      select: { defaultSetsPerExercise: true },
    }),
  ]);

  const metaById = new Map(exercisesMeta.map((e) => [e.id, e]));
  const defaultSets =
    prefRow?.defaultSetsPerExercise ?? PREFS_DEFAULTS.defaultSetsPerExercise;

  const rows: {
    sessionId: string;
    exerciseId: string;
    setNumber: number;
    position: number;
    reps: number | null;
    weight: number | null;
    seconds: number | null;
  }[] = [];

  for (const entry of entries) {
    const last = lastByExercise.get(entry.exerciseId);
    const fromHistory = last?.sets.length ?? 0;
    const hint = hints?.get(entry.exerciseId);
    const fromPlanned = hint?.plannedSets ?? null;
    const meta = metaById.get(entry.exerciseId);
    const isTime = meta?.metric === 'time';
    const fromPrescription =
      fromHistory === 0 && fromPlanned === null
        ? parsePrescriptionSetCount(meta?.prescription ?? null)
        : null;
    const setCount = Math.max(
      1,
      fromHistory > 0
        ? fromHistory
        : (fromPlanned ?? fromPrescription ?? defaultSets),
    );

    for (let i = 0; i < setCount; i++) {
      // Reach for the same set index from last time, or fall back to the last
      // set we have history for. Without history, fall through to the planned
      // hint matching the exercise's metric.
      const fromSet = last?.sets[i] ?? last?.sets[last.sets.length - 1];
      const reps = isTime
        ? null
        : (fromSet?.reps ?? (fromHistory === 0 ? (hint?.plannedReps ?? null) : null));
      const seconds = isTime
        ? (fromSet?.seconds ?? (fromHistory === 0 ? (hint?.plannedSeconds ?? null) : null))
        : null;
      rows.push({
        sessionId: entry.sessionId,
        exerciseId: entry.exerciseId,
        setNumber: i + 1,
        position: entry.position,
        reps,
        weight: fromSet?.weight ?? null,
        seconds,
      });
    }
  }
  return rows;
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

  const rows = await buildSeededSetLogRows(
    userId,
    toAdd.map((exId, idx) => ({
      exerciseId: exId,
      sessionId: session.id,
      position: startPosition + idx,
    })),
    session.id,
  );
  await db.setLog.createMany({ data: rows });

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
      // Pre-fill from the previous set so progressive overload is one tap away.
      // For time-metric exercises, seconds carries forward; for reps-metric,
      // reps + weight. Whichever isn't relevant just stays null on both rows.
      reps: lastSet.reps,
      weight: lastSet.weight,
      seconds: lastSet.seconds,
    },
  });

  metrics.setsLogged.inc();
  revalidatePath('/');
});

// Each field is optional + nullable: callers send only the fields they actually
// edited. The UI dispatches reps/weight for metric='reps' exercises and seconds
// (plus optional weight, e.g. weighted carries) for metric='time' exercises. We
// don't mutex at the action level — the worst case is a stale client writes
// both, which is harmless since the metric dictates which field is read.
const UpdateSetSchema = z.object({
  setLogId: z.string().min(1),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  weight: z.number().min(0).max(10000).nullable().optional(),
  seconds: z.number().int().min(0).max(3600).nullable().optional(),
});

export const updateSet = withLogging('updateSet', async (input: z.infer<typeof UpdateSetSchema>) => {
  const userId = await requireUser();
  const { setLogId, reps, weight, seconds } = UpdateSetSchema.parse(input);

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
    data: {
      ...(reps !== undefined ? { reps } : {}),
      ...(weight !== undefined ? { weight } : {}),
      ...(seconds !== undefined ? { seconds } : {}),
    },
  });

  revalidatePath('/');
});

const RepeatLastSchema = z.object({ exerciseId: z.string().min(1) });

/**
 * Snap the current exercise's sets to match the user's last completed session
 * for that exercise — matching set count, copying reps/weight. Useful as a
 * one-tap escape hatch when the auto-seed didn't quite line up, or when the
 * user added more sets and wants to revert to the prior pattern.
 *
 * No-op if the exercise has no prior history. Preserves notes on existing
 * rows that survive the snap. Renumbers atomically, like removeSet.
 */
export const repeatLastForExercise = withLogging('repeatLastForExercise', async (
  input: z.infer<typeof RepeatLastSchema>,
) => {
  const userId = await requireUser();
  const { exerciseId } = RepeatLastSchema.parse(input);

  await requireAvailableExercise(userId, exerciseId);
  const session = await findActiveSession(userId);
  if (!session) throw new Error('No active session');

  const lastByExercise = await getLastSetsForExerciseIds(
    userId,
    [exerciseId],
    session.id,
  );
  const last = lastByExercise.get(exerciseId);
  if (!last || last.sets.length === 0) return;

  const current = await db.setLog.findMany({
    where: { sessionId: session.id, exerciseId },
    orderBy: { setNumber: 'asc' },
  });
  if (current.length === 0) throw new Error('Exercise not in active session');

  // All current sets share the same position — preserve it for new rows.
  const position = current[0].position;
  const targetCount = last.sets.length;

  await db.$transaction(async (tx) => {
    // Drop overflow first so setNumber renumbering can't collide.
    if (current.length > targetCount) {
      const toDrop = current.slice(targetCount).map((s) => s.id);
      await tx.setLog.deleteMany({ where: { id: { in: toDrop } } });
    }
    // Update the rows we keep, copying reps/weight/seconds from last-time.
    const toKeep = current.slice(0, targetCount);
    for (let i = 0; i < toKeep.length; i++) {
      const row = toKeep[i];
      const src = last.sets[i];
      if (
        row.reps !== src.reps ||
        row.weight !== src.weight ||
        row.seconds !== src.seconds
      ) {
        await tx.setLog.update({
          where: { id: row.id },
          data: { reps: src.reps, weight: src.weight, seconds: src.seconds },
        });
      }
    }
    // Create any extra sets last-time had that we don't.
    if (current.length < targetCount) {
      const toCreate = last.sets.slice(current.length).map((src, idx) => ({
        sessionId: session.id,
        exerciseId,
        setNumber: current.length + idx + 1,
        position,
        reps: src.reps,
        weight: src.weight,
        seconds: src.seconds,
      }));
      await tx.setLog.createMany({ data: toCreate });
    }
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
  // 'reps' (default) or 'time'. Determines which input the set row renders.
  metric: z.enum(['reps', 'time']).optional(),
  // Optional equipment tags (see Exercise.equipment in schema.prisma). Empty
  // when omitted; the routine preset filter treats unknown equipment as
  // "always available," which is the right fallback for user-created customs.
  equipment: z.array(z.string().trim().max(40)).max(20).optional(),
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
    metric,
    equipment,
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
        metric: metric ?? 'reps',
        equipment: equipment ?? [],
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
  defaultSetsPerExercise: z.number().int().min(1).max(20).optional(),
  defaultWeightIncrement: z.number().min(0.25).max(50).optional(),
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
    // Clearing — but only this field. If a weight-increment override exists
    // we keep the row; otherwise we drop it so we don't leave empty settings
    // rows lying around.
    const existing = await db.exerciseUserSettings.findUnique({
      where: { userId_exerciseId: { userId, exerciseId } },
      select: { weightIncrement: true },
    });
    if (existing && existing.weightIncrement !== null) {
      await db.exerciseUserSettings.update({
        where: { userId_exerciseId: { userId, exerciseId } },
        data: { restTimerSeconds: null },
      });
    } else {
      await db.exerciseUserSettings.deleteMany({ where: { userId, exerciseId } });
    }
  } else {
    await db.exerciseUserSettings.upsert({
      where: { userId_exerciseId: { userId, exerciseId } },
      create: { userId, exerciseId, restTimerSeconds },
      update: { restTimerSeconds },
    });
  }

  revalidatePath('/');
});

const SetExerciseWeightIncrementSchema = z.object({
  exerciseId: z.string().min(1),
  // null = clear the override (fall back to global). Otherwise 0.25-50.
  weightIncrement: z.number().min(0.25).max(50).nullable(),
});

/**
 * Set or clear the per-exercise weight-stepper increment for the current user.
 * Mirrors setExerciseRestOverride. The +/- buttons next to the weight input
 * use the override when present, otherwise the user's global default.
 */
export const setExerciseWeightIncrement = withLogging('setExerciseWeightIncrement', async (
  input: z.infer<typeof SetExerciseWeightIncrementSchema>,
) => {
  const userId = await requireUser();
  const { exerciseId, weightIncrement } = SetExerciseWeightIncrementSchema.parse(input);

  const exercise = await db.exercise.findFirst({
    where: {
      id: exerciseId,
      OR: [{ ownerId: null }, { ownerId: userId }],
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!exercise) throw new Error('Exercise not found');

  if (weightIncrement === null) {
    const existing = await db.exerciseUserSettings.findUnique({
      where: { userId_exerciseId: { userId, exerciseId } },
      select: { restTimerSeconds: true },
    });
    if (existing && existing.restTimerSeconds !== null) {
      await db.exerciseUserSettings.update({
        where: { userId_exerciseId: { userId, exerciseId } },
        data: { weightIncrement: null },
      });
    } else {
      await db.exerciseUserSettings.deleteMany({ where: { userId, exerciseId } });
    }
  } else {
    await db.exerciseUserSettings.upsert({
      where: { userId_exerciseId: { userId, exerciseId } },
      create: { userId, exerciseId, weightIncrement },
      update: { weightIncrement },
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

  // Create the session, then seed SetLogs from history + prefs. The seed step
  // runs after the session create commits because buildSeededSetLogRows needs
  // a fixed sessionId and reads from completed sessions (which it must not
  // see this brand-new in-progress one — the excludeSessionId param guards it,
  // but separating the writes also keeps the read-then-write logic outside the
  // transaction, where the additional queries don't extend transaction time.)
  const newSession = await db.workoutSession.create({
    data: { userId, date: new Date() },
  });
  const hints = new Map(
    usable.map((te) => [
      te.exerciseId,
      {
        plannedSets: te.plannedSets,
        plannedReps: te.plannedReps,
        plannedSeconds: te.plannedSeconds,
      },
    ]),
  );
  const rows = await buildSeededSetLogRows(
    userId,
    usable.map((te, idx) => ({
      exerciseId: te.exerciseId,
      sessionId: newSession.id,
      position: idx,
    })),
    newSession.id,
    hints,
  );
  await db.setLog.createMany({ data: rows });

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
// One routine per user (DB-enforced via @unique on Routine.userId). Each day
// owns its own WorkoutTemplate — picking a "seed" template at add-time copies
// the seed's exercises into a fresh per-day template, so subsequent edits to
// either side don't bleed across. We detect routine-owned templates via the
// existing `routineDays` reverse relation (`routineDays: { some: {} }`) and
// hide them from the regular templates list. Capped at MAX_ROUTINE_DAYS to
// keep the timeline UI bounded.

const ScheduleStyleSchema = z.enum(['sequence', 'weekday']);

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function requireUserTemplate(userId: string, templateId: string) {
  // Ownership-or-built-in check. Built-ins (userId null) are reachable to
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

/**
 * Pick a name for a new template that won't collide with the user's existing
 * templates. Tries `base` first, then `base (2)`, `base (3)`, etc. We rely on
 * a single SELECT and resolve in JS — fine at the small scales involved.
 */
async function uniqueTemplateName(tx: Tx, userId: string, base: string): Promise<string> {
  const trimmed = base.trim() || 'Day';
  const taken = new Set(
    (
      await tx.workoutTemplate.findMany({
        where: { userId, name: { startsWith: trimmed } },
        select: { name: true },
      })
    ).map((t) => t.name),
  );
  if (!taken.has(trimmed)) return trimmed;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('Too many similarly-named templates — pick a different base name.');
}

/**
 * Snapshot a source template's exercises into a fresh user-owned template.
 * The source must be reachable to the user (own or built-in); soft-deleted
 * exercises in the source are skipped silently. Returns the new template id.
 */
async function cloneTemplateForUser(
  tx: Tx,
  userId: string,
  sourceTemplateId: string,
  desiredName: string,
): Promise<string> {
  const source = await tx.workoutTemplate.findFirst({
    where: {
      id: sourceTemplateId,
      OR: [{ userId }, { userId: null, isBuiltin: true }],
    },
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: { exercise: { select: { deletedAt: true, ownerId: true } } },
      },
    },
  });
  if (!source) throw new Error('Template not found');

  const lineup = source.exercises.filter(
    (te) =>
      te.exercise.deletedAt === null &&
      (te.exercise.ownerId === null || te.exercise.ownerId === userId),
  );

  const name = await uniqueTemplateName(tx, userId, desiredName);
  const created = await tx.workoutTemplate.create({
    data: {
      userId,
      isBuiltin: false,
      name,
      exercises: {
        create: lineup.map((te, position) => ({
          exerciseId: te.exerciseId,
          position,
          plannedSets: te.plannedSets,
          plannedReps: te.plannedReps,
          plannedSeconds: te.plannedSeconds,
        })),
      },
    },
  });
  return created.id;
}

/**
 * Create a fresh blank template owned by the user, optionally seeded with an
 * explicit list of exercise ids (in array order). Used when the user builds a
 * day from scratch. Validates exercise access; refuses dup ids.
 */
type FreshTemplateExerciseInput = {
  exerciseId: string;
  plannedSets?: number | null;
  plannedReps?: number | null;
  plannedSeconds?: number | null;
};

async function freshTemplateForUser(
  tx: Tx,
  userId: string,
  desiredName: string,
  exercises: FreshTemplateExerciseInput[],
): Promise<string> {
  const exerciseIds = exercises.map((e) => e.exerciseId);
  if (new Set(exerciseIds).size !== exerciseIds.length) {
    throw new Error("A day can't list the same exercise twice.");
  }
  if (exerciseIds.length > 0) {
    const accessible = await tx.exercise.findMany({
      where: {
        id: { in: exerciseIds },
        OR: [{ ownerId: null }, { ownerId: userId }],
        deletedAt: null,
      },
      select: { id: true },
    });
    const accessibleIds = new Set(accessible.map((e) => e.id));
    for (const id of exerciseIds) {
      if (!accessibleIds.has(id)) throw new Error('Exercise not available');
    }
  }
  const name = await uniqueTemplateName(tx, userId, desiredName);
  const created = await tx.workoutTemplate.create({
    data: {
      userId,
      isBuiltin: false,
      name,
      exercises: {
        create: exercises.map((e, position) => ({
          exerciseId: e.exerciseId,
          position,
          plannedSets: e.plannedSets ?? null,
          plannedReps: e.plannedReps ?? null,
          plannedSeconds: e.plannedSeconds ?? null,
        })),
      },
    },
  });
  return created.id;
}

const CreateRoutineSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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
      name: name || 'My routine',
      description: description || null,
      scheduleStyle,
    },
  });

  revalidatePath('/');
  revalidatePath('/routine');
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
      // Mode change: clear weekday pins; cursor reset is handled below in the
      // routine update. Switching from weekday → sequence keeps days in their
      // current `position` order; sequence → weekday leaves them unpinned for
      // the user to assign.
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
  revalidatePath('/routine');
  revalidatePath('/settings');
});

/**
 * Delete the user's routine and all the per-day templates it owns. The
 * routine.deleteMany cascades into RoutineDay (and its pending swaps), but
 * the templates have no inbound cascade — we collect their ids first and
 * delete them after the routine cascade fires. Sessions that referenced any
 * of these days lose their FK (SetNull) but remain in history; their SetLogs
 * still reference the underlying exercises directly, so workout history is
 * unaffected by template deletion.
 */
export const deleteRoutine = withLogging('deleteRoutine', async () => {
  const userId = await requireUser();
  await db.$transaction(async (tx) => {
    const routine = await tx.routine.findUnique({
      where: { userId },
      include: { days: { select: { templateId: true } } },
    });
    if (!routine) return;
    const ownedTemplateIds = routine.days.map((d) => d.templateId);
    await tx.routine.delete({ where: { id: routine.id } });
    if (ownedTemplateIds.length > 0) {
      await tx.workoutTemplate.deleteMany({
        where: { id: { in: ownedTemplateIds }, userId },
      });
    }
  });
  revalidatePath('/');
  revalidatePath('/routine');
  revalidatePath('/settings');
});

const AddRoutineDaySchema = z
  .object({
    seedTemplateId: z.string().min(1).optional(),
    exerciseIds: z.array(z.string().min(1)).max(50).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    label: z.string().trim().max(60).optional(),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
  })
  .refine((d) => !(d.seedTemplateId && d.exerciseIds && d.exerciseIds.length > 0), {
    message: 'Pass either seedTemplateId or exerciseIds, not both.',
  });

/**
 * Append a day to the routine. New day's position = current count
 * (0-indexed, contiguous). Always creates a fresh template owned by the
 * user — either by cloning a `seedTemplateId` (lifting its exercises) or by
 * starting blank/with the provided `exerciseIds`. The day's template name is
 * derived from `name`, the seed's name, or a positional fallback ("Day N" /
 * weekday short label), with collisions resolved via uniqueTemplateName.
 *
 * For weekday mode, weekday must be in 0..6 and not already pinned — we
 * pre-check for a friendly error. For sequence mode, weekday is silently
 * ignored (stored as null even if provided).
 */
export const addRoutineDay = withLogging('addRoutineDay', async (
  input: z.infer<typeof AddRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { seedTemplateId, exerciseIds, name, label, weekday } =
    AddRoutineDaySchema.parse(input);

  const routine = await db.routine.findUnique({
    where: { userId },
    include: { _count: { select: { days: true } } },
  });
  if (!routine) throw new Error('No routine — create one first');

  if (routine._count.days >= MAX_ROUTINE_DAYS) {
    throw new Error(`A routine can have at most ${MAX_ROUTINE_DAYS} days.`);
  }

  const effectiveWeekday =
    routine.scheduleStyle === 'weekday' && weekday != null ? weekday : null;
  if (effectiveWeekday !== null) {
    const collision = await db.routineDay.findFirst({
      where: { routineId: routine.id, weekday: effectiveWeekday },
      select: { id: true },
    });
    if (collision) {
      throw new Error('That weekday is already taken in your routine.');
    }
  }

  const fallbackName =
    name ||
    (effectiveWeekday !== null
      ? WEEKDAY_LONG[effectiveWeekday]
      : `Day ${routine._count.days + 1}`);

  await db.$transaction(async (tx) => {
    // If a seed was given, look up its name once so the clone inherits it
    // (overridable by the explicit `name` arg).
    let templateBaseName = name || fallbackName;
    if (!name && seedTemplateId) {
      const seed = await tx.workoutTemplate.findFirst({
        where: { id: seedTemplateId },
        select: { name: true },
      });
      if (seed) templateBaseName = seed.name;
    }

    const templateId = seedTemplateId
      ? await cloneTemplateForUser(tx, userId, seedTemplateId, templateBaseName)
      : await freshTemplateForUser(
          tx,
          userId,
          templateBaseName,
          (exerciseIds ?? []).map((id) => ({ exerciseId: id })),
        );

    await tx.routineDay.create({
      data: {
        routineId: routine.id,
        templateId,
        position: routine._count.days,
        weekday: effectiveWeekday,
        label: label || null,
      },
    });
  });

  revalidatePath('/');
  revalidatePath('/routine');
  revalidatePath('/settings');
});

const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const UpdateRoutineDaySchema = z.object({
  routineDayId: z.string().min(1),
  label: z.string().trim().max(60).nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  // Renaming the day really means renaming the day's owned template — the
  // template's `name` is what the timeline and editors surface as the day's
  // identity. We resolve collisions with uniqueTemplateName so the user's
  // chosen text is preserved when possible.
  name: z.string().trim().min(1).max(80).optional(),
});

export const updateRoutineDay = withLogging('updateRoutineDay', async (
  input: z.infer<typeof UpdateRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, label, weekday, name } = UpdateRoutineDaySchema.parse(input);

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: { routine: { select: { id: true, scheduleStyle: true } } },
  });
  if (!day) throw new Error('Routine day not found');

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

  await db.$transaction(async (tx) => {
    if (name !== undefined) {
      const resolved = await uniqueTemplateName(tx, userId, name);
      await tx.workoutTemplate.update({
        where: { id: day.templateId },
        data: { name: resolved },
      });
    }
    if (label !== undefined || effectiveWeekday !== undefined) {
      await tx.routineDay.update({
        where: { id: routineDayId },
        data: {
          ...(label !== undefined ? { label: label || null } : {}),
          ...(effectiveWeekday !== undefined ? { weekday: effectiveWeekday } : {}),
        },
      });
    }
  });

  revalidatePath('/');
  revalidatePath('/routine');
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

    // The day owned its template — drop it now that nothing references it.
    // Skipped for the rare legacy case where a routine day pointed at a
    // built-in template (userId null) before we moved to per-day cloning.
    await tx.workoutTemplate.deleteMany({
      where: { id: day.templateId, userId },
    });

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
  revalidatePath('/routine');
  revalidatePath('/settings');
});

// ============================================================
// Editing a routine day's exercises (operates on the day's owned template)
// ============================================================

// Sane bounds for planned numbers. plannedSets caps at 20 to mirror the
// defaultSetsPerExercise schema; plannedReps at 100 (real rep ranges); and
// plannedSeconds at 3600 (one hour, easily covers any reasonable hold or
// loaded carry). Time-based exercises store their plan in plannedSeconds, not
// plannedReps — historically a "60s plank" was stored as plannedReps=60, which
// the data model now distinguishes properly.
const PlannedSetsSchema = z.number().int().min(1).max(20).nullable().optional();
const PlannedRepsSchema = z.number().int().min(1).max(100).nullable().optional();
const PlannedSecondsSchema = z.number().int().min(1).max(3600).nullable().optional();

const AddExerciseToRoutineDaySchema = z.object({
  routineDayId: z.string().min(1),
  exerciseId: z.string().min(1),
  plannedSets: PlannedSetsSchema,
  plannedReps: PlannedRepsSchema,
  plannedSeconds: PlannedSecondsSchema,
});

export const addExerciseToRoutineDay = withLogging('addExerciseToRoutineDay', async (
  input: z.infer<typeof AddExerciseToRoutineDaySchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, exerciseId, plannedSets, plannedReps, plannedSeconds } =
    AddExerciseToRoutineDaySchema.parse(input);

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    select: { templateId: true },
  });
  if (!day) throw new Error('Routine day not found');

  await requireAvailableExercise(userId, exerciseId);

  const collision = await db.templateExercise.findFirst({
    where: { templateId: day.templateId, exerciseId },
    select: { id: true },
  });
  if (collision) throw new Error('That exercise is already in this day.');

  const last = await db.templateExercise.findFirst({
    where: { templateId: day.templateId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const nextPos = (last?.position ?? -1) + 1;

  await db.templateExercise.create({
    data: {
      templateId: day.templateId,
      exerciseId,
      position: nextPos,
      plannedSets: plannedSets ?? null,
      plannedReps: plannedReps ?? null,
      plannedSeconds: plannedSeconds ?? null,
    },
  });

  revalidatePath('/');
  revalidatePath('/routine');
});

const UpdateRoutineDayExerciseSchema = z.object({
  routineDayId: z.string().min(1),
  exerciseId: z.string().min(1),
  plannedSets: PlannedSetsSchema,
  plannedReps: PlannedRepsSchema,
  plannedSeconds: PlannedSecondsSchema,
});

/**
 * Edit a routine-day exercise's planned set/rep/seconds numbers. Pass null to
 * clear a field; omit to leave it untouched. Operates on the day's owned
 * template.
 */
export const updateRoutineDayExercise = withLogging('updateRoutineDayExercise', async (
  input: z.infer<typeof UpdateRoutineDayExerciseSchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, exerciseId, plannedSets, plannedReps, plannedSeconds } =
    UpdateRoutineDayExerciseSchema.parse(input);

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    select: { templateId: true },
  });
  if (!day) throw new Error('Routine day not found');

  const target = await db.templateExercise.findFirst({
    where: { templateId: day.templateId, exerciseId },
    select: { id: true },
  });
  if (!target) throw new Error("That exercise isn't in this day.");

  await db.templateExercise.update({
    where: { id: target.id },
    data: {
      ...(plannedSets !== undefined ? { plannedSets } : {}),
      ...(plannedReps !== undefined ? { plannedReps } : {}),
      ...(plannedSeconds !== undefined ? { plannedSeconds } : {}),
    },
  });

  revalidatePath('/');
  revalidatePath('/routine');
});

const RemoveExerciseFromRoutineDaySchema = z.object({
  routineDayId: z.string().min(1),
  exerciseId: z.string().min(1),
});

export const removeExerciseFromRoutineDay = withLogging(
  'removeExerciseFromRoutineDay',
  async (input: z.infer<typeof RemoveExerciseFromRoutineDaySchema>) => {
    const userId = await requireUser();
    const { routineDayId, exerciseId } = RemoveExerciseFromRoutineDaySchema.parse(input);

    const day = await db.routineDay.findFirst({
      where: { id: routineDayId, routine: { userId } },
      select: { templateId: true },
    });
    if (!day) throw new Error('Routine day not found');

    await db.$transaction(async (tx) => {
      const target = await tx.templateExercise.findFirst({
        where: { templateId: day.templateId, exerciseId },
        select: { id: true, position: true },
      });
      if (!target) return;

      await tx.templateExercise.delete({ where: { id: target.id } });

      // Renumber to keep positions contiguous.
      const remaining = await tx.templateExercise.findMany({
        where: { templateId: day.templateId },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].position !== i) {
          await tx.templateExercise.update({
            where: { id: remaining[i].id },
            data: { position: i },
          });
        }
      }

      // Drop any pending swap that referenced this exercise — it can't apply
      // anymore.
      await tx.routineDayPendingSwap.deleteMany({
        where: { routineDayId, OR: [{ outExerciseId: exerciseId }, { inExerciseId: exerciseId }] },
      });
    });

    revalidatePath('/');
    revalidatePath('/routine');
  },
);

const ReorderRoutineDayExerciseSchema = z.object({
  routineDayId: z.string().min(1),
  exerciseId: z.string().min(1),
  direction: z.enum(['up', 'down']),
});

export const reorderRoutineDayExercise = withLogging(
  'reorderRoutineDayExercise',
  async (input: z.infer<typeof ReorderRoutineDayExerciseSchema>) => {
    const userId = await requireUser();
    const { routineDayId, exerciseId, direction } = ReorderRoutineDayExerciseSchema.parse(input);

    const day = await db.routineDay.findFirst({
      where: { id: routineDayId, routine: { userId } },
      select: { templateId: true },
    });
    if (!day) throw new Error('Routine day not found');

    const entries = await db.templateExercise.findMany({
      where: { templateId: day.templateId },
      orderBy: { position: 'asc' },
      select: { id: true, exerciseId: true, position: true },
    });
    const myIndex = entries.findIndex((e) => e.exerciseId === exerciseId);
    if (myIndex < 0) return;
    const neighborIndex = direction === 'up' ? myIndex - 1 : myIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= entries.length) return;

    const me = entries[myIndex];
    const neighbor = entries[neighborIndex];
    const sentinel = -1;

    await db.$transaction([
      db.templateExercise.update({ where: { id: me.id }, data: { position: sentinel } }),
      db.templateExercise.update({
        where: { id: neighbor.id },
        data: { position: me.position },
      }),
      db.templateExercise.update({
        where: { id: me.id },
        data: { position: neighbor.position },
      }),
    ]);

    revalidatePath('/');
    revalidatePath('/routine');
  },
);

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
  revalidatePath('/routine');
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
 * Permanent swap: edit the day's owned template, replacing `outExerciseId`
 * with `inExerciseId` at the same position. Each routine day owns its own
 * template now, so this only affects this day — no other surface inherits
 * the change.
 */
export const swapInRoutineTemplate = withLogging('swapInRoutineTemplate', async (
  input: z.infer<typeof SwapInRoutineTemplateSchema>,
) => {
  const userId = await requireUser();
  const { routineDayId, outExerciseId, inExerciseId } = SwapInRoutineTemplateSchema.parse(input);

  if (outExerciseId === inExerciseId) return;

  const day = await db.routineDay.findFirst({
    where: { id: routineDayId, routine: { userId } },
    include: { template: { select: { id: true } } },
  });
  if (!day) throw new Error('Routine day not found');

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
  revalidatePath('/routine');
  revalidatePath('/settings');
});

// Wizard-driven routine creation. Lets the user assemble a whole routine in
// one shot — every day always seeds its own owned template (either by
// cloning the picked seed's exercises, or starting blank with the supplied
// exercise list). All-or-nothing: a failure mid-build rolls everything back,
// so a bailed wizard never leaves orphan rows.

const DraftExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  plannedSets: PlannedSetsSchema,
  plannedReps: PlannedRepsSchema,
  plannedSeconds: PlannedSecondsSchema,
});

const DraftDaySchema = z
  .object({
    // The day's display name — becomes the day's owned template name. Optional;
    // server fills in a positional fallback ("Day N" / weekday) when omitted.
    name: z.string().trim().min(1).max(80).optional(),
    // Pick one: either seed from an existing template (clones its exercises)
    // or supply a list of exercises (in array order, with optional planned
    // sets/reps per exercise). Both empty = blank day.
    seedTemplateId: z.string().min(1).optional(),
    exercises: z.array(DraftExerciseSchema).max(50).optional(),
    label: z.string().trim().max(60).optional(),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
  })
  .refine((d) => !(d.seedTemplateId && d.exercises && d.exercises.length > 0), {
    message: 'Pass either seedTemplateId or exercises, not both.',
  });

const CreateRoutineFromDraftSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  scheduleStyle: ScheduleStyleSchema,
  days: z.array(DraftDaySchema).min(1).max(MAX_ROUTINE_DAYS),
});

/**
 * Create a routine and all of its days in one transaction. Each day always
 * owns its own template — either by cloning a `seedTemplateId` (lifting the
 * source's exercises) or by starting with the supplied exerciseIds list.
 * Throws and rolls back if anything fails.
 */
export const createRoutineFromDraft = withLogging('createRoutineFromDraft', async (
  input: z.infer<typeof CreateRoutineFromDraftSchema>,
) => {
  const userId = await requireUser();
  const { name, description, scheduleStyle, days } = CreateRoutineFromDraftSchema.parse(input);

  const existingRoutine = await db.routine.findUnique({ where: { userId } });
  if (existingRoutine) {
    throw new Error('You already have a routine. Edit it instead of creating a new one.');
  }

  // In weekday mode, each pinned weekday must be unique within the draft.
  // Sequence mode silently drops weekday hints.
  if (scheduleStyle === 'weekday') {
    const seen = new Set<number>();
    for (const day of days) {
      if (day.weekday == null) continue;
      if (seen.has(day.weekday)) {
        throw new Error("Two days can't share the same weekday.");
      }
      seen.add(day.weekday);
    }
  }

  await db.$transaction(async (tx) => {
    const routine = await tx.routine.create({
      data: {
        userId,
        name: name || 'My routine',
        description: description || null,
        scheduleStyle,
      },
    });

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const effectiveWeekday =
        scheduleStyle === 'weekday' && day.weekday != null ? day.weekday : null;

      // Determine the day's template name: explicit > seed's name > positional
      // fallback. uniqueTemplateName will resolve any collisions on insert.
      let baseName = day.name?.trim() || '';
      if (!baseName && day.seedTemplateId) {
        const seed = await tx.workoutTemplate.findFirst({
          where: { id: day.seedTemplateId },
          select: { name: true },
        });
        if (seed) baseName = seed.name;
      }
      if (!baseName) {
        baseName =
          effectiveWeekday !== null ? WEEKDAY_LONG[effectiveWeekday] : `Day ${i + 1}`;
      }

      const templateId = day.seedTemplateId
        ? await cloneTemplateForUser(tx, userId, day.seedTemplateId, baseName)
        : await freshTemplateForUser(
            tx,
            userId,
            baseName,
            (day.exercises ?? []).map((e) => ({
              exerciseId: e.exerciseId,
              plannedSets: e.plannedSets ?? null,
              plannedReps: e.plannedReps ?? null,
              plannedSeconds: e.plannedSeconds ?? null,
            })),
          );

      await tx.routineDay.create({
        data: {
          routineId: routine.id,
          templateId,
          position: i,
          weekday: effectiveWeekday,
          label: day.label?.trim() || null,
        },
      });
    }
  });

  metrics.templatesUsed.inc();
  revalidatePath('/');
  revalidatePath('/routine');
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
  // The slot's plannedSets/plannedReps stay with the slot — a one-shot swap
  // is "do exercise B in this slot today," not "import B's planning."
  const lineup: {
    exerciseId: string;
    plannedSets: number | null;
    plannedReps: number | null;
    plannedSeconds: number | null;
  }[] = [];
  for (const te of day.template.exercises) {
    const ex = te.exercise;
    const replacement = swapsByOutId.get(te.exerciseId);
    if (replacement !== undefined) {
      lineup.push({
        exerciseId: replacement,
        plannedSets: te.plannedSets,
        plannedReps: te.plannedReps,
        plannedSeconds: te.plannedSeconds,
      });
    } else if (ex.deletedAt === null && (ex.ownerId === null || ex.ownerId === userId)) {
      lineup.push({
        exerciseId: te.exerciseId,
        plannedSets: te.plannedSets,
        plannedReps: te.plannedReps,
        plannedSeconds: te.plannedSeconds,
      });
    }
  }

  if (lineup.length === 0) {
    throw new Error('This day has no usable exercises right now.');
  }

  // Create the session, then seed SetLogs from history + planned + prefs.
  // Same shape as startFromTemplate — split the create from the seed so the
  // exclude-self guard works cleanly.
  const newSession = await db.workoutSession.create({
    data: {
      userId,
      date: new Date(),
      startedFromRoutineDayId: day.id,
    },
  });
  const hints = new Map(
    lineup.map((l) => [
      l.exerciseId,
      {
        plannedSets: l.plannedSets,
        plannedReps: l.plannedReps,
        plannedSeconds: l.plannedSeconds,
      },
    ]),
  );
  const rows = await buildSeededSetLogRows(
    userId,
    lineup.map((l, idx) => ({
      exerciseId: l.exerciseId,
      sessionId: newSession.id,
      position: idx,
    })),
    newSession.id,
    hints,
  );
  await db.$transaction([
    db.setLog.createMany({ data: rows }),
    db.routineDayPendingSwap.deleteMany({
      where: { routineDayId: day.id },
    }),
  ]);

  metrics.templatesUsed.inc();
  revalidatePath('/');
});
