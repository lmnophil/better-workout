// Workout page. Server component — loads everything the tracker needs in one
// pass, then hands off to a client component for interaction.
//
// Note: user preferences are NOT loaded here — the layout's PrefsProvider
// owns that state and exposes it via context. The getUserPreferences query
// is React.cache'd, so even when both load in a request, only one DB hit
// happens (just none here right now).

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import {
  getActiveSession,
  getAvailableExercises,
  getExerciseUsageStats,
  getLastSetsByExercise,
  getTemplates,
  getRoutineForUser,
  getRoutineRecentSessions,
  getUserBands,
} from '@/lib/queries';
import { pickTodaysRoutineDay, pickUpcomingRoutineDays, isScheduleStyle } from '@/lib/routine';
import { getRequestTimeZone } from '@/lib/timezone';
import { WorkoutView } from '@/components/workout/workout-view';
import type {
  RoutineDayClient,
  RoutineDayExerciseClient,
  RoutineRecentSessionClient,
} from '@/components/routines/routine-timeline';

export const metadata = { title: 'Workout — Tracker' };

export default async function WorkoutPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [
    activeSession,
    availableExercises,
    templates,
    routine,
    recentRoutineSessions,
    bands,
    usageStats,
  ] = await Promise.all([
    getActiveSession(userId),
    getAvailableExercises(userId),
    getTemplates(userId),
    getRoutineForUser(userId),
    getRoutineRecentSessions(userId, 5),
    getUserBands(userId),
    getExerciseUsageStats(userId),
  ]);

  // Only fetch "last time" data after we know the active session id (to exclude it)
  const lastSetsByExercise = await getLastSetsByExercise(userId, activeSession?.id);

  // Shape routine data for the timeline. The workout view decides whether to
  // render it based on whether an active session is present.
  function shapeDay(d: NonNullable<typeof routine>['days'][number]): RoutineDayClient {
    const swapByOutId = new Map<string, { id: string; name: string }>();
    for (const sw of d.pendingSwaps) {
      // Filter out swaps pointing at unusable (soft-deleted) exercises so
      // the UI never offers a stale one. Matches startFromRoutineDay's
      // apply-time filter.
      if (sw.inExercise.deletedAt !== null) continue;
      swapByOutId.set(sw.outExerciseId, {
        id: sw.inExercise.id,
        name: sw.inExercise.name,
      });
    }
    const exercises: RoutineDayExerciseClient[] = d.template.exercises
      .filter((te) => te.exercise.deletedAt === null)
      .map((te) => {
        const swap = swapByOutId.get(te.exerciseId);
        return {
          exerciseId: te.exerciseId,
          name: te.exercise.name,
          module: te.exercise.module,
          position: te.position,
          poolId: te.poolId,
          plannedSets: te.plannedSets,
          plannedReps: te.plannedReps,
          plannedSeconds: te.plannedSeconds,
          videoUrl: te.exercise.videoUrl,
          equipment: te.exercise.equipment,
          pendingSwapInExerciseId: swap?.id,
          pendingSwapInExerciseName: swap?.name,
        };
      });
    return {
      id: d.id,
      position: d.position,
      weekday: d.weekday,
      label: d.label,
      templateId: d.templateId,
      templateName: d.template.name,
      templateIsBuiltin: d.template.isBuiltin,
      exercises,
      pools: d.template.pools.map((p) => ({
        id: p.id,
        pickCount: p.pickCount,
        label: p.label,
      })),
    };
  }

  const scheduleStyle =
    routine && isScheduleStyle(routine.scheduleStyle)
      ? routine.scheduleStyle
      : ('sequence' as const);

  // Resolve "today" in the user's timezone (cookie-fed; see lib/timezone.ts) so
  // the weekday picker and the day label don't flip in the server's UTC evening.
  const timeZone = await getRequestTimeZone();
  const now = new Date();
  const todaysDay = routine ? pickTodaysRoutineDay(routine, now, timeZone) : null;
  const upcomingRaw = routine ? pickUpcomingRoutineDays(routine, todaysDay, now, timeZone) : [];
  const todayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(now);

  const routineForView = routine
    ? {
        routine: {
          name: routine.name,
          description: routine.description,
          scheduleStyle,
          todayLabel,
        },
        todaysDay: todaysDay ? shapeDay(todaysDay) : null,
        upcomingDays: upcomingRaw.map(shapeDay),
        recentSessions: recentRoutineSessions.map<RoutineRecentSessionClient>((s) => ({
          id: s.id,
          date: s.date.toISOString(),
          dayId: s.startedFromRoutineDay?.id ?? null,
          dayLabel: s.startedFromRoutineDay?.label ?? null,
          templateName: s.startedFromRoutineDay?.template.name ?? null,
          setCount: s._count.setLogs,
        })),
        usageStats: Array.from(usageStats.entries()).map(([exerciseId, stat]) => ({
          exerciseId,
          lastDoneDate: stat.lastDoneDate.toISOString(),
          sessionCount: stat.sessionCount,
        })),
      }
    : null;

  // Convert Map to a serializable structure for the client component boundary
  const lastSetsArray = Array.from(lastSetsByExercise.entries()).map(([exerciseId, data]) => ({
    exerciseId,
    sessionDate: data.sessionDate.toISOString(),
    sets: data.sets,
  }));

  // Per-exercise notes from the routine day this session was started from, if
  // any. Surfaced read-only in ExerciseInSession so the user sees the cues
  // they wrote (tempo, breathing, coach annotations) while lifting. Only
  // non-empty notes flow through.
  const routineExerciseNotes =
    activeSession?.startedFromRoutineDay?.template.exercises
      .filter((e): e is { exerciseId: string; note: string } => e.note !== null)
      .map((e) => ({ exerciseId: e.exerciseId, note: e.note })) ?? [];

  return (
    <WorkoutView
      activeSession={
        activeSession
          ? {
              id: activeSession.id,
              date: activeSession.date.toISOString(),
              setLogs: activeSession.setLogs.map((s) => ({
                id: s.id,
                exerciseId: s.exerciseId,
                setNumber: s.setNumber,
                reps: s.reps,
                weight: s.weight,
                seconds: s.seconds,
                bandId: s.bandId,
                notes: s.notes,
              })),
            }
          : null
      }
      availableExercises={availableExercises.map((e) => ({
        id: e.id,
        name: e.name,
        module: e.module,
        prescription: e.prescription,
        primaryMuscles: e.primaryMuscles,
        secondaryMuscles: e.secondaryMuscles,
        videoUrl: e.videoUrl,
        isCustom: e.isCustom,
        metric: e.metric,
        loadType: e.loadType,
        equipment: e.equipment,
        restTimerSecondsOverride: e.restTimerSecondsOverride,
        weightIncrementOverride: e.weightIncrementOverride,
      }))}
      lastSets={lastSetsArray}
      routineExerciseNotes={routineExerciseNotes}
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        isBuiltin: t.isBuiltin,
        exerciseCount: t.exercises.length,
        // Preview shows up to 3 exercise names; gracefully handles
        // exercises that have been deleted out from under the template.
        previewNames: t.exercises
          .slice(0, 3)
          .map((te) => (te.exercise.deletedAt ? '(removed)' : te.exercise.name)),
        plannedExercises: t.exercises
          .filter((te) => te.exercise.deletedAt === null)
          .map((te) => ({
            exerciseId: te.exerciseId,
            plannedSets: te.plannedSets,
            plannedReps: te.plannedReps,
            plannedSeconds: te.plannedSeconds,
          })),
        updatedAt: t.updatedAt.toISOString(),
      }))}
      routine={routineForView}
      bands={bands}
    />
  );
}
