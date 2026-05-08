// Server-side queries for the workout tracker.
// All queries scope by userId — never trust client input for ownership.

import { cache } from 'react';
import { db } from '@/lib/db';

export type ActiveSession = Awaited<ReturnType<typeof getActiveSession>>;
export type AvailableExercise = Awaited<ReturnType<typeof getAvailableExercises>>[number];

/**
 * Get the user's currently in-progress session, if any.
 * Active = completedAt is null. By app convention there's at most one.
 */
export async function getActiveSession(userId: string) {
  return db.workoutSession.findFirst({
    where: { userId, completedAt: null },
    orderBy: { date: 'desc' },
    include: {
      setLogs: {
        // Order by user-controlled position first, then set number within an exercise
        orderBy: [{ position: 'asc' }, { setNumber: 'asc' }],
      },
    },
  });
}

/**
 * Get all exercises the user can pick from:
 *   - Built-ins (ownerId null)
 *   - Their own customs (ownerId = userId, not soft-deleted)
 *
 * Each exercise is augmented with `restTimerSecondsOverride` (null = no override,
 * use the user's global default). Loaded as a single inner query so we don't N+1.
 */
export async function getAvailableExercises(userId: string) {
  const exercises = await db.exercise.findMany({
    where: {
      OR: [{ ownerId: null }, { ownerId: userId }],
      deletedAt: null,
    },
    orderBy: [{ isCustom: 'asc' }, { module: 'asc' }, { name: 'asc' }],
  });

  const settings = await db.exerciseUserSettings.findMany({
    where: { userId },
    select: { exerciseId: true, restTimerSeconds: true },
  });
  const settingsByExerciseId = new Map(
    settings.map((s) => [s.exerciseId, s.restTimerSeconds]),
  );

  return exercises.map((e) => ({
    ...e,
    restTimerSecondsOverride: settingsByExerciseId.get(e.id) ?? null,
  }));
}

/**
 * For each exercise the user has ever logged in a *completed* session,
 * return the sets from the most recent such session. Drives the "last time"
 * display next to each exercise in the active session.
 *
 * Excludes the active session (passed by id) so an in-progress workout doesn't
 * shadow the actually-previous one.
 *
 * Capped to the trailing 180 days. After 6 months idle the "last time" ref is
 * more confusing than helpful (form has likely changed, body has changed),
 * and the cap bounds memory growth — without it, this query loads every
 * completed session ever.
 */
export async function getLastSetsByExercise(userId: string, excludeSessionId?: string) {
  const since = new Date();
  since.setDate(since.getDate() - 180);

  const sessions = await db.workoutSession.findMany({
    where: {
      userId,
      completedAt: { not: null },
      date: { gte: since },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    orderBy: { date: 'desc' },
    include: {
      setLogs: { orderBy: { setNumber: 'asc' } },
    },
  });

  // Walk sessions newest-first, claim each exercise on first sight.
  const result = new Map<
    string,
    {
      sessionDate: Date;
      sets: {
        setNumber: number;
        reps: number | null;
        weight: number | null;
        notes: string | null;
      }[];
    }
  >();

  for (const session of sessions) {
    // Group this session's setLogs by exerciseId
    const byExercise = new Map<string, typeof session.setLogs>();
    for (const set of session.setLogs) {
      if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
      byExercise.get(set.exerciseId)!.push(set);
    }
    // Claim any exercises not yet seen
    for (const [exerciseId, sets] of byExercise) {
      if (!result.has(exerciseId)) {
        result.set(exerciseId, {
          sessionDate: session.date,
          sets: sets.map((s) => ({
            setNumber: s.setNumber,
            reps: s.reps,
            weight: s.weight,
            notes: s.notes,
          })),
        });
      }
    }
  }

  return result;
}

// ============================================================
// COVERAGE & VOLUME
// ============================================================

/**
 * For each muscle group the user has ever worked, return the date of the most
 * recent completed session that included it. Drives the color-graded coverage map.
 *
 * Both primary and secondary muscles count for recency — being touched at all
 * "freshens" the muscle. (Volume tracking weights them differently; coverage doesn't.)
 *
 * Capped to the trailing 90 days. The UI's color gradient maxes out at 7 days
 * of neglect, so anything older renders identically — querying further back is
 * just loading rows we'd discard anyway.
 */
export async function getCoverageData(userId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const sessions = await db.workoutSession.findMany({
    where: { userId, completedAt: { not: null }, date: { gte: since } },
    orderBy: { date: 'desc' },
    include: {
      setLogs: {
        include: {
          exercise: { select: { primaryMuscles: true, secondaryMuscles: true } },
        },
      },
    },
  });

  // Walk newest-first; first appearance wins
  const lastWorkedByMuscle = new Map<string, Date>();
  for (const session of sessions) {
    for (const setLog of session.setLogs) {
      const allMuscles = [
        ...setLog.exercise.primaryMuscles,
        ...setLog.exercise.secondaryMuscles,
      ];
      for (const muscle of allMuscles) {
        if (!lastWorkedByMuscle.has(muscle)) {
          lastWorkedByMuscle.set(muscle, session.date);
        }
      }
    }
  }
  return lastWorkedByMuscle;
}

/**
 * Total weighted sets per muscle in the trailing 7 days (completed sessions only).
 *
 * Each set contributes:
 *   - 1.0 to each primary muscle
 *   - 0.5 to each secondary muscle
 *
 * Result is rounded to one decimal so "5.5 sets" can show. The weighted model
 * captures that compound lifts (e.g. squats) give *some* hamstring credit
 * without claiming full credit.
 */
export async function getWeeklyVolume(userId: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const setLogs = await db.setLog.findMany({
    where: {
      session: {
        userId,
        completedAt: { not: null },
        date: { gte: sevenDaysAgo },
      },
    },
    include: {
      exercise: { select: { primaryMuscles: true, secondaryMuscles: true } },
    },
  });

  const counts = new Map<string, number>();
  for (const setLog of setLogs) {
    for (const muscle of setLog.exercise.primaryMuscles) {
      counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
    }
    for (const muscle of setLog.exercise.secondaryMuscles) {
      counts.set(muscle, (counts.get(muscle) ?? 0) + 0.5);
    }
  }
  // Round to 1 decimal so the UI shows "5.5" instead of "5.499999"
  for (const [k, v] of counts) {
    counts.set(k, Math.round(v * 10) / 10);
  }
  return counts;
}

/**
 * Get the user's volume target overrides as a map keyed by muscleId.
 */
export async function getUserVolumeTargets(userId: string) {
  const rows = await db.userVolumeTarget.findMany({ where: { userId } });
  return new Map(rows.map((r) => [r.muscleId, r.target]));
}

/**
 * Get the user's preferences. Returns defaults if no row exists — we lazily
 * create the row on first write rather than on read, so this can run cheaply
 * on every page load.
 */
// Wrapped with React.cache so multiple callers in a single request (e.g. the
// app layout and the workout page) share one DB hit.
export const getUserPreferences = cache(async function getUserPreferences(userId: string) {
  const row = await db.userPreferences.findUnique({ where: { userId } });
  return {
    restTimerEnabled: row?.restTimerEnabled ?? true,
    restTimerSeconds: row?.restTimerSeconds ?? 90,
    restTimerSound: row?.restTimerSound ?? true,
    restTimerVibrate: row?.restTimerVibrate ?? true,
  };
});

export type UserPreferencesShape = Awaited<ReturnType<typeof getUserPreferences>>;

/**
 * List all of a user's saved workout templates, with their exercises in order.
 * Drives both the management view and the "start from template" picker.
 */
export async function getTemplates(userId: string) {
  return db.workoutTemplate.findMany({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }],
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: {
          exercise: {
            select: { id: true, name: true, module: true, deletedAt: true },
          },
        },
      },
    },
  });
}
