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
} from '@/lib/queries';
import { WorkoutView } from '@/components/workout/workout-view';

export const metadata = { title: 'Workout — Tracker' };

export default async function WorkoutPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [activeSession, availableExercises, templates] = await Promise.all([
    getActiveSession(userId),
    getAvailableExercises(userId),
    getTemplates(userId),
  ]);

  // Only fetch "last time" data after we know the active session id (to exclude it)
  const lastSetsByExercise = await getLastSetsByExercise(userId, activeSession?.id);

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
        restTimerSecondsOverride: e.restTimerSecondsOverride,
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
    />
  );
}
