// Public share view — renders a routine read-only, with comment / suggest /
// react widgets. No auth required. The trust boundary is the share token in
// the URL and a per-share reviewer cookie set during registration. See the
// "Routine sharing" ADR in docs/decisions.md for the full design rationale.

import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getShareByToken, getShareActivity } from '@/lib/queries';
import { isScheduleStyle } from '@/lib/routine';
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
  const [activity, libraryExercises] = await Promise.all([
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
  ]);

  const jar = await cookies();
  const reviewerKey = jar.get(`${SHARE_COOKIE_PREFIX}${share.id}`)?.value ?? null;
  const reviewer = reviewerKey
    ? await db.shareReviewer.findUnique({
        where: { shareId_reviewerKey: { shareId: share.id, reviewerKey } },
        select: { id: true, displayName: true },
      })
    : null;

  // First-time visitor — collect display name before showing any UI that
  // would let them post. Server actions also enforce this; the gate is a
  // friendlier surface than a runtime error.
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
        })),
    })),
  };

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
    />
  );
}
