// /routine — the dedicated home for routine editing. Replaces the old
// build-wizard plus settings-editor split. Empty state (no routine yet) and
// populated state (existing routine) are handled by the same client editor.

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Share2 } from 'lucide-react';
import {
  getAvailableExercises,
  getExerciseUsageStats,
  getRoutineForUser,
  getTemplates,
  getUserPreferences,
  getUserVolumeTargets,
} from '@/lib/queries';
import { isScheduleStyle } from '@/lib/routine';
import { MUSCLE_GROUPS } from '@/lib/exercises-data';
import { effectiveBounds } from '@/lib/coverage';
import { RoutineEditor } from '@/components/routines/routine-editor';

export const metadata = { title: 'Routine — Tracker' };

export default async function RoutinePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [routine, templates, availableExercises, userTargets, prefs, usageStats] =
    await Promise.all([
      getRoutineForUser(userId),
      getTemplates(userId),
      getAvailableExercises(userId),
      getUserVolumeTargets(userId),
      getUserPreferences(userId),
      getExerciseUsageStats(userId),
    ]);

  // Project muscle groups + per-user target overrides into a flat shape the
  // editor can use to build its structural coverage panel without re-fetching.
  // Mobility/balance entries with no default target stay in the list — the
  // panel surfaces them as "recency-only" so they're visible but not graded.
  const muscleGroups = MUSCLE_GROUPS.map((g) => {
    const bounds = effectiveBounds(g, prefs.volumeTier, userTargets.get(g.id));
    return {
      id: g.id,
      label: g.label,
      category: g.category,
      min: bounds?.min ?? null,
      target: bounds?.target ?? null,
      isOverridden: userTargets.has(g.id),
      description: g.description ?? null,
    };
  });

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
          description: d.description,
          name: d.template.name,
          exercises: d.template.exercises
            .filter((te) => te.exercise.deletedAt === null)
            .map((te) => ({
              templateExerciseId: te.id,
              exerciseId: te.exerciseId,
              name: te.exercise.name,
              module: te.exercise.module,
              position: te.position,
              poolId: te.poolId,
              plannedSets: te.plannedSets,
              plannedReps: te.plannedReps,
              plannedSeconds: te.plannedSeconds,
              note: te.note,
              metric: te.exercise.metric,
              primaryMuscles: te.exercise.primaryMuscles,
              secondaryMuscles: te.exercise.secondaryMuscles,
            })),
          pools: d.template.pools.map((p) => ({
            id: p.id,
            pickCount: p.pickCount,
            label: p.label,
          })),
        })),
      }
    : null;

  // Trailing-year usage stats, serialized for the client boundary. Feeds the
  // recency/count hints in the editor's exercise picker.
  const usageStatsForClient = Array.from(usageStats.entries()).map(([exerciseId, stat]) => ({
    exerciseId,
    lastDoneDate: stat.lastDoneDate.toISOString(),
    sessionCount: stat.sessionCount,
  }));

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
    <>
      {routine && (
        <div className="px-5 pt-4 -mb-2 flex justify-end">
          <Link
            href="/routine/shares"
            className="inline-flex items-center gap-1.5 text-xs text-ink-300 hover:text-ink-100 border border-ink-700 hover:border-ink-500 rounded-md px-2 py-1"
          >
            <Share2 size={12} /> share for review
          </Link>
        </div>
      )}
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
          metric: e.metric,
          loadType: e.loadType,
          equipment: e.equipment,
          restTimerSecondsOverride: e.restTimerSecondsOverride,
          weightIncrementOverride: e.weightIncrementOverride,
        }))}
        muscleGroups={muscleGroups}
        usageStats={usageStatsForClient}
      />
    </>
  );
}
