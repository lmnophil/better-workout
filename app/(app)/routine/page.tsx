// /routine — the dedicated home for routine editing. Replaces the old
// build-wizard plus settings-editor split. Empty state (no routine yet) and
// populated state (existing routine) are handled by the same client editor.

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import {
  getAvailableExercises,
  getRoutineForUser,
  getTemplates,
} from '@/lib/queries';
import { isScheduleStyle } from '@/lib/routine';
import { RoutineEditor } from '@/components/routines/routine-editor';

export const metadata = { title: 'Routine — Tracker' };

export default async function RoutinePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [routine, templates, availableExercises] = await Promise.all([
    getRoutineForUser(userId),
    getTemplates(userId),
    getAvailableExercises(userId),
  ]);

  // Project the routine into a client-friendly shape. Each day's identity is
  // its owned template's name; we surface the exercise lineup in display order
  // so the editor can render and reorder without re-fetching.
  const routineForClient = routine
    ? {
        id: routine.id,
        name: routine.name,
        description: routine.description,
        scheduleStyle: isScheduleStyle(routine.scheduleStyle)
          ? routine.scheduleStyle
          : ('sequence' as const),
        lastCompletedPosition: routine.lastCompletedPosition,
        days: routine.days.map((d) => ({
          id: d.id,
          position: d.position,
          weekday: d.weekday,
          label: d.label,
          name: d.template.name,
          exercises: d.template.exercises
            .filter((te) => te.exercise.deletedAt === null)
            .map((te) => ({
              templateExerciseId: te.id,
              exerciseId: te.exerciseId,
              name: te.exercise.name,
              module: te.exercise.module,
              position: te.position,
            })),
        })),
      }
    : null;

  // Templates the user can seed a new day from. getTemplates already excludes
  // routine-owned templates, so picking one always means "clone someone
  // else's lineup," not "share a template across two days."
  const seedTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isBuiltin: t.isBuiltin,
    exerciseNames: t.exercises
      .filter((te) => te.exercise.deletedAt === null)
      .map((te) => te.exercise.name),
  }));

  return (
    <RoutineEditor
      routine={routineForClient}
      seedTemplates={seedTemplates}
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
        weightIncrementOverride: e.weightIncrementOverride,
      }))}
    />
  );
}
