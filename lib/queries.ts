// Server-side queries for the workout tracker.
// All queries scope by userId — never trust client input for ownership.

import { cache } from 'react';
import { db } from '@/lib/db';
import { PREFS_DEFAULTS, type UserPrefs } from '@/lib/prefs';

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
    select: { exerciseId: true, restTimerSeconds: true, weightIncrement: true },
  });
  const settingsByExerciseId = new Map(
    settings.map((s) => [s.exerciseId, s] as const),
  );

  return exercises.map((e) => {
    const s = settingsByExerciseId.get(e.id);
    return {
      ...e,
      restTimerSecondsOverride: s?.restTimerSeconds ?? null,
      weightIncrementOverride: s?.weightIncrement ?? null,
    };
  });
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

/**
 * Most-recent completed-session sets for a specific list of exerciseIds.
 *
 * Like getLastSetsByExercise but scoped — used by seeding when exercises are
 * added to a session, so we can pre-populate set count and reps/weight from
 * the user's prior workout. Returns a Map keyed by exerciseId; missing keys
 * mean "no prior session for this exercise."
 *
 * Same 180-day window as getLastSetsByExercise — older history is stale enough
 * that pre-filling from it would be more confusing than helpful.
 */
export async function getLastSetsForExerciseIds(
  userId: string,
  exerciseIds: string[],
  excludeSessionId?: string,
) {
  if (exerciseIds.length === 0) {
    return new Map<
      string,
      { sets: { reps: number | null; weight: number | null }[] }
    >();
  }
  const since = new Date();
  since.setDate(since.getDate() - 180);

  const sessions = await db.workoutSession.findMany({
    where: {
      userId,
      completedAt: { not: null },
      date: { gte: since },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      setLogs: { some: { exerciseId: { in: exerciseIds } } },
    },
    orderBy: { date: 'desc' },
    include: {
      setLogs: {
        where: { exerciseId: { in: exerciseIds } },
        orderBy: { setNumber: 'asc' },
      },
    },
  });

  const result = new Map<
    string,
    { sets: { reps: number | null; weight: number | null }[] }
  >();
  for (const session of sessions) {
    for (const set of session.setLogs) {
      if (result.has(set.exerciseId)) continue;
      // Collect every set for this exerciseId in this session, in order.
      const sets = session.setLogs
        .filter((s) => s.exerciseId === set.exerciseId)
        .map((s) => ({ reps: s.reps, weight: s.weight }));
      result.set(set.exerciseId, { sets });
    }
    if (result.size === exerciseIds.length) break;
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
export const getUserPreferences = cache(async function getUserPreferences(
  userId: string,
): Promise<UserPrefs> {
  const row = await db.userPreferences.findUnique({ where: { userId } });
  if (!row) return { ...PREFS_DEFAULTS };
  return {
    restTimerEnabled: row.restTimerEnabled,
    restTimerSeconds: row.restTimerSeconds,
    restTimerSound: row.restTimerSound,
    restTimerVibrate: row.restTimerVibrate,
    defaultSetsPerExercise: row.defaultSetsPerExercise,
    defaultWeightIncrement: row.defaultWeightIncrement,
  };
});

export type UserPreferencesShape = UserPrefs;

/**
 * List the templates a user sees in the picker: their own user templates plus
 * any built-in (isBuiltin = true, userId = null) templates they haven't hidden.
 *
 * Built-ins are sorted before user templates within the same recency band so
 * the empty state has a stable, recognizable lead. User templates win recency
 * ordering against each other as before.
 */
export async function getTemplates(userId: string) {
  return db.workoutTemplate.findMany({
    where: {
      // Templates owned by a routine day are surfaced through the routine
      // timeline, not the regular template list — exclude them here.
      routineDays: { none: {} },
      OR: [
        { userId },
        {
          userId: null,
          isBuiltin: true,
          hiddenBy: { none: { userId } },
        },
      ],
    },
    orderBy: [{ isBuiltin: 'desc' }, { updatedAt: 'desc' }],
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: {
          exercise: {
            select: {
              id: true,
              name: true,
              module: true,
              deletedAt: true,
              primaryMuscles: true,
              secondaryMuscles: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Fetch the user's routine (or null) with all days, their templates, and any
 * pending one-time swaps. Single query — used by both the settings editor and
 * the workout-page timeline view.
 */
export async function getRoutineForUser(userId: string) {
  return db.routine.findUnique({
    where: { userId },
    include: {
      days: {
        orderBy: { position: 'asc' },
        include: {
          template: {
            include: {
              exercises: {
                orderBy: { position: 'asc' },
                include: {
                  exercise: {
                    select: {
                      id: true,
                      name: true,
                      module: true,
                      deletedAt: true,
                      primaryMuscles: true,
                      secondaryMuscles: true,
                    },
                  },
                },
              },
            },
          },
          pendingSwaps: {
            include: {
              outExercise: { select: { id: true, name: true, deletedAt: true } },
              inExercise: { select: { id: true, name: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });
}

export type RoutineForView = NonNullable<Awaited<ReturnType<typeof getRoutineForUser>>>;

/**
 * Recent completed sessions started from a routine day. Drives the "Recent"
 * portion of the timeline view. Bounded by `take` so the timeline never
 * renders an unbounded list.
 */
export async function getRoutineRecentSessions(userId: string, take: number = 10) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  return db.workoutSession.findMany({
    where: {
      userId,
      completedAt: { not: null },
      startedFromRoutineDayId: { not: null },
      date: { gte: since },
    },
    orderBy: { date: 'desc' },
    take,
    include: {
      startedFromRoutineDay: {
        select: {
          id: true,
          position: true,
          weekday: true,
          label: true,
          template: { select: { id: true, name: true } },
        },
      },
      _count: { select: { setLogs: true } },
    },
  });
}

/**
 * List built-in templates the user has hidden. Powers the settings page
 * "Hidden default templates" section so they can unhide any.
 */
export async function getHiddenBuiltinTemplates(userId: string) {
  const rows = await db.userHiddenTemplate.findMany({
    where: { userId },
    include: {
      template: {
        select: {
          id: true,
          name: true,
          description: true,
          isBuiltin: true,
          exercises: { select: { id: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  // Defensive: a hide row could exist for a template that's no longer built-in
  // (shouldn't happen, but the schema doesn't enforce it). Filter those out.
  return rows.filter((r) => r.template.isBuiltin);
}
