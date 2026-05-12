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
 *
 * Also pulls the routine-day template the session was started from (if any),
 * so the active-session UI can surface per-exercise notes the user wrote on
 * the routine. Notes are scoped to the day's template at start time — if the
 * user edits the routine mid-session, the change shows up immediately because
 * this loads live from the template, not a session-time snapshot.
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
      startedFromRoutineDay: {
        select: {
          template: {
            select: {
              exercises: {
                select: { exerciseId: true, note: true },
              },
            },
          },
        },
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
  // The two reads are independent — fire them in parallel so we don't wait
  // for the exercise list before starting the per-user settings query.
  const [exercises, settings] = await Promise.all([
    db.exercise.findMany({
      where: {
        OR: [{ ownerId: null }, { ownerId: userId }],
        deletedAt: null,
      },
      orderBy: [{ isCustom: 'asc' }, { module: 'asc' }, { name: 'asc' }],
    }),
    db.exerciseUserSettings.findMany({
      where: { userId },
      select: { exerciseId: true, restTimerSeconds: true, weightIncrement: true },
    }),
  ]);
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

  // Use `select` to pull only the columns we serialize to the client. Skipping
  // setLog id/sessionId/position trims wire and memory cost for users with
  // hundreds of trailing-180-day sessions.
  const sessions = await db.workoutSession.findMany({
    where: {
      userId,
      completedAt: { not: null },
      date: { gte: since },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    orderBy: { date: 'desc' },
    select: {
      date: true,
      setLogs: {
        orderBy: { setNumber: 'asc' },
        select: {
          exerciseId: true,
          setNumber: true,
          reps: true,
          weight: true,
          seconds: true,
          notes: true,
        },
      },
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
        seconds: number | null;
        notes: string | null;
      }[];
    }
  >();

  for (const session of sessions) {
    // Group this session's setLogs by exerciseId, skipping any already claimed
    // by a newer session so we don't waste work building unused arrays.
    const byExercise = new Map<string, typeof session.setLogs>();
    for (const set of session.setLogs) {
      if (result.has(set.exerciseId)) continue;
      let bucket = byExercise.get(set.exerciseId);
      if (!bucket) {
        bucket = [];
        byExercise.set(set.exerciseId, bucket);
      }
      bucket.push(set);
    }
    for (const [exerciseId, sets] of byExercise) {
      result.set(exerciseId, {
        sessionDate: session.date,
        sets: sets.map((s) => ({
          setNumber: s.setNumber,
          reps: s.reps,
          weight: s.weight,
          seconds: s.seconds,
          notes: s.notes,
        })),
      });
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
      { sets: { reps: number | null; weight: number | null; seconds: number | null }[] }
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
    select: {
      setLogs: {
        where: { exerciseId: { in: exerciseIds } },
        orderBy: { setNumber: 'asc' },
        select: {
          exerciseId: true,
          reps: true,
          weight: true,
          seconds: true,
        },
      },
    },
  });

  const result = new Map<
    string,
    { sets: { reps: number | null; weight: number | null; seconds: number | null }[] }
  >();
  for (const session of sessions) {
    // Group this session's filtered setLogs by exerciseId in one pass —
    // skipping ones already claimed by a newer session so we don't build
    // arrays we'd discard. Replaces a prior nested `filter` that was O(n²)
    // in the session's setLog count.
    const byExercise = new Map<
      string,
      { reps: number | null; weight: number | null; seconds: number | null }[]
    >();
    for (const s of session.setLogs) {
      if (result.has(s.exerciseId)) continue;
      let bucket = byExercise.get(s.exerciseId);
      if (!bucket) {
        bucket = [];
        byExercise.set(s.exerciseId, bucket);
      }
      bucket.push({ reps: s.reps, weight: s.weight, seconds: s.seconds });
    }
    for (const [exerciseId, sets] of byExercise) {
      result.set(exerciseId, { sets });
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
    select: {
      date: true,
      setLogs: {
        select: {
          exercise: { select: { primaryMuscles: true, secondaryMuscles: true } },
        },
      },
    },
  });

  // Walk newest-first; first appearance wins.
  const lastWorkedByMuscle = new Map<string, Date>();
  for (const session of sessions) {
    for (const setLog of session.setLogs) {
      for (const muscle of setLog.exercise.primaryMuscles) {
        if (!lastWorkedByMuscle.has(muscle)) {
          lastWorkedByMuscle.set(muscle, session.date);
        }
      }
      for (const muscle of setLog.exercise.secondaryMuscles) {
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
    select: {
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
                      metric: true,
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

// ================================================================
// ROUTINE SHARING + NOTIFICATIONS
// ================================================================

/**
 * Fetch a routine purely by share token. Returns null if the token is unknown,
 * the share is revoked, or the routine has been deleted. Includes the same
 * nested shape as `getRoutineForUser` so the public view can render the full
 * routine without re-fetching. Does NOT include the share's reviewer rows,
 * comments, or suggestions — those are loaded separately so we can scope
 * per-reviewer for the public page.
 */
export async function getShareByToken(token: string) {
  const share = await db.routineShare.findUnique({
    where: { token },
    include: {
      routine: {
        include: {
          user: { select: { id: true, name: true, email: true } },
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
                          metric: true,
                          deletedAt: true,
                          primaryMuscles: true,
                          secondaryMuscles: true,
                          prescription: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!share || share.revokedAt !== null) return null;
  return share;
}

export type SharedRoutine = NonNullable<Awaited<ReturnType<typeof getShareByToken>>>;

/**
 * All comments + structured suggestions + reactions on a share, joined with
 * the reviewer who created them. One query per kind keeps the shape tidy on
 * the public page (which renders threads grouped by target).
 */
export async function getShareActivity(shareId: string) {
  const [comments, suggestions, reactions] = await Promise.all([
    db.shareComment.findMany({
      where: { shareId },
      orderBy: { createdAt: 'asc' },
      include: { reviewer: { select: { id: true, displayName: true } } },
    }),
    db.shareSuggestion.findMany({
      where: { shareId },
      orderBy: { createdAt: 'asc' },
      include: { reviewer: { select: { id: true, displayName: true } } },
    }),
    db.shareReaction.findMany({
      where: { shareId },
      orderBy: { createdAt: 'asc' },
      include: { reviewer: { select: { id: true, displayName: true } } },
    }),
  ]);
  return { comments, suggestions, reactions };
}

/**
 * List every share link the user has minted. Includes a small open-count
 * roll-up so the management UI can show "3 unresolved suggestions" at a
 * glance without a separate query.
 */
export async function getRoutineSharesForUser(userId: string) {
  const shares = await db.routineShare.findMany({
    where: { routine: { userId } },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          reviewers: true,
          comments: { where: { resolvedAt: null } },
          suggestions: { where: { state: 'open' } },
          reactions: true,
        },
      },
    },
  });
  return shares;
}

/**
 * The owner-facing inbox feed. Unread first (`readAt: null` desc), then read
 * by recency. Bounded so the dropdown stays small.
 */
export async function getNotificationsForUser(userId: string, take: number = 30) {
  return db.notification.findMany({
    where: { userId },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take,
  });
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}
