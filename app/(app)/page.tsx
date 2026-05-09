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
  getLastSetsByExercise,
  getTemplates,
  getRoutineForUser,
  getRoutineRecentSessions,
} from '@/lib/queries';
import {
  pickTodaysRoutineDay,
  pickUpcomingRoutineDays,
  isScheduleStyle,
} from '@/lib/routine';
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

  const [activeSession, availableExercises, templates, routine, recentRoutineSessions] =
    await Promise.all([
      getActiveSession(userId),
      getAvailableExercises(userId),
      getTemplates(userId),
      getRoutineForUser(userId),
      getRoutineRecentSessions(userId, 5),
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
    };
  }

  const scheduleStyle = routine && isScheduleStyle(routine.scheduleStyle)
    ? routine.scheduleStyle
    : ('sequence' as const);

  const todaysDay = routine ? pickTodaysRoutineDay(routine) : null;
  const upcomingRaw = routine ? pickUpcomingRoutineDays(routine, todaysDay) : [];

  const routineForView = routine
    ? {
        routine: {
          name: routine.name,
          description: routine.description,
          scheduleStyle,
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
      }
    : null;

  // Convert Map to a serializable structure for the client component boundary
  const lastSetsArray = Array.from(lastSetsByExercise.entries()).map(
    ([exerciseId, data]) => ({
      exerciseId,
      sessionDate: data.sessionDate.toISOString(),
      sets: data.sets,
    }),
  );

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
        equipment: e.equipment,
        restTimerSecondsOverride: e.restTimerSecondsOverride,
        weightIncrementOverride: e.weightIncrementOverride,
      }))}
      lastSets={lastSetsArray}
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
        updatedAt: t.updatedAt.toISOString(),
      }))}
      routine={routineForView}
    />
  );
}
