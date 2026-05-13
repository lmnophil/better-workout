// Public share view — renders a routine read-only, with comment / suggest /
// react widgets. No auth required. The trust boundary is the share token in
// the URL and a per-share reviewer cookie set during registration. See the
// "Routine sharing" ADR in docs/decisions.md for the full design rationale.

import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import {
  getShareByToken,
  getShareActivity,
  getUserPreferences,
  getUserVolumeTargets,
} from '@/lib/queries';
import { isScheduleStyle } from '@/lib/routine';
import { MUSCLE_GROUPS } from '@/lib/exercises-data';
import { computeRoutineVolumes, effectiveBounds } from '@/lib/coverage';
import { ReviewerGate } from '@/components/share/reviewer-gate';
import { ShareView } from '@/components/share/share-view';

export const metadata = { title: 'Shared routine' };

// Reviewer cookie name mirrors the constant in lib/actions.ts. Duplicated
// rather than imported because that file is 'use server' and we only need
// the name shape here.
const SHARE_COOKIE_PREFIX = 'share_reviewer_';

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const share = await getShareByToken(token);
  if (!share) notFound();

  // The routine + nested template/exercise data is already loaded by
  // getShareByToken; pull the activity (comments, suggestions, reactions)
  // alongside, and pull the available-exercise library for the reviewer-side
  // picker. The reviewer sees built-ins only — the owner's custom exercises
  // outside this routine aren't part of the share's surface, and customs
  // already on the routine are visible through the routine itself.
  //
  // Coverage data: load the owner's tier preset + per-muscle overrides so the
  // reviewer's panel matches what the owner sees in their own routine editor.
  const [activity, libraryExercises, ownerPrefs, ownerOverrides] = await Promise.all([
    getShareActivity(share.id),
    db.exercise.findMany({
      where: { ownerId: null, deletedAt: null },
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        module: true,
        primaryMuscles: true,
        secondaryMuscles: true,
        metric: true,
      },
    }),
    getUserPreferences(share.routine.user.id),
    getUserVolumeTargets(share.routine.user.id),
  ]);

  const jar = await cookies();
  const reviewerKey = jar.get(`${SHARE_COOKIE_PREFIX}${share.id}`)?.value ?? null;
  const reviewer = reviewerKey
    ? await db.shareReviewer.findUnique({
        where: { shareId_reviewerKey: { shareId: share.id, reviewerKey } },
        select: { id: true, displayName: true },
      })
    : null;

  if (!reviewer) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <ReviewerGate
          token={token}
          ownerName={share.routine.user.name ?? share.routine.user.email ?? 'a friend'}
          routineName={share.routine.name}
        />
      </main>
    );
  }

  // Project the routine into a client-friendly shape that mirrors the
  // existing /routine page's structure. The share view never mutates the
  // routine; it just renders + collects reviewer activity.
  const routineForClient = {
    id: share.routine.id,
    name: share.routine.name,
    description: share.routine.description,
    scheduleStyle: isScheduleStyle(share.routine.scheduleStyle)
      ? share.routine.scheduleStyle
      : ('sequence' as const),
    ownerName: share.routine.user.name ?? share.routine.user.email ?? 'a friend',
    days: share.routine.days.map((d) => ({
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
          metric: te.exercise.metric,
          primaryMuscles: te.exercise.primaryMuscles,
          secondaryMuscles: te.exercise.secondaryMuscles,
          plannedSets: te.plannedSets,
          plannedReps: te.plannedReps,
          plannedSeconds: te.plannedSeconds,
          plannedWeight: te.plannedWeight,
          videoUrl: te.exercise.videoUrl,
          equipment: te.exercise.equipment,
        })),
    })),
  };

  // Compute structural coverage now so the reviewer panel renders with the
  // numbers baked in. Suggestion diffs are recomputed client-side from the
  // same per-muscle bounds — they only depend on the (already shipped)
  // exercise→muscle data plus the proposed payload.
  const exerciseLookup = new Map<string, { primaryMuscles: string[]; secondaryMuscles: string[] }>();
  for (const ex of libraryExercises) {
    exerciseLookup.set(ex.id, {
      primaryMuscles: ex.primaryMuscles,
      secondaryMuscles: ex.secondaryMuscles,
    });
  }
  for (const d of routineForClient.days) {
    for (const ex of d.exercises) {
      if (!exerciseLookup.has(ex.exerciseId)) {
        exerciseLookup.set(ex.exerciseId, {
          primaryMuscles: ex.primaryMuscles,
          secondaryMuscles: ex.secondaryMuscles,
        });
      }
    }
  }

  const { totals: baseTotals, anyEstimated } = computeRoutineVolumes(
    routineForClient.days.map((d) => ({
      exercises: d.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        plannedSets: ex.plannedSets,
      })),
    })),
    exerciseLookup,
  );

  const muscleGroupsForClient = MUSCLE_GROUPS.map((g) => {
    const bounds = effectiveBounds(g, ownerPrefs.volumeTier, ownerOverrides.get(g.id));
    return {
      id: g.id,
      label: g.label,
      category: g.category,
      min: bounds?.min ?? null,
      target: bounds?.target ?? null,
      isOverridden: ownerOverrides.has(g.id),
      description: g.description ?? null,
    };
  });

  // Plain-object form for client transport (Maps are not serialized cleanly).
  const baseTotalsForClient = Array.from(baseTotals.entries()).map(([id, v]) => ({
    id,
    sets: v.sets,
    estimated: v.estimated,
  }));

  return (
    <ShareView
      token={token}
      reviewer={reviewer}
      routine={routineForClient}
      activity={{
        comments: activity.comments.map((c) => ({
          id: c.id,
          reviewerId: c.reviewerId,
          reviewerName: c.reviewer.displayName,
          targetType: c.targetType,
          targetId: c.targetId,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          resolvedAt: c.resolvedAt?.toISOString() ?? null,
        })),
        suggestions: activity.suggestions.map((s) => ({
          id: s.id,
          reviewerId: s.reviewerId,
          reviewerName: s.reviewer.displayName,
          kind: s.kind,
          targetType: s.targetType,
          targetId: s.targetId,
          payload: s.payload as Record<string, unknown>,
          state: s.state,
          createdAt: s.createdAt.toISOString(),
        })),
        reactions: activity.reactions.map((r) => ({
          id: r.id,
          reviewerId: r.reviewerId,
          reviewerName: r.reviewer.displayName,
          targetType: r.targetType,
          targetId: r.targetId,
          kind: r.kind,
        })),
      }}
      library={libraryExercises}
      coverage={{
        muscleGroups: muscleGroupsForClient,
        baseTotals: baseTotalsForClient,
        anyEstimated,
        ownerTier: ownerPrefs.volumeTier,
      }}
    />
  );
}
