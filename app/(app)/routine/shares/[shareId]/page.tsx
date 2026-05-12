// Owner-side review page for a single share. Lists every reviewer's activity
// (suggestions + comments + reactions) and gives one-click apply / reject /
// resolve affordances for structured suggestions.

import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { getShareActivity } from '@/lib/queries';
import { ShareDetail } from '@/components/share-owner/share-detail';

export const metadata = { title: 'Share review — Tracker' };

export default async function ShareDetailPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const { shareId } = await params;

  const share = await db.routineShare.findFirst({
    where: { id: shareId, routine: { userId } },
    include: {
      routine: {
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
                        select: { id: true, name: true, primaryMuscles: true },
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
  if (!share) notFound();

  const activity = await getShareActivity(share.id);

  // Build a label map so suggestion summaries can render readable names
  // instead of opaque cuids. Includes routine, days, template-exercises, and
  // the exercise library used in the routine.
  const labels = new Map<string, string>();
  labels.set(`routine:${share.routineId}`, share.routine.name);
  for (const day of share.routine.days) {
    labels.set(`routine_day:${day.id}`, day.template.name);
    for (const te of day.template.exercises) {
      labels.set(`template_exercise:${te.id}`, te.exercise.name);
    }
  }
  // Exercise name lookup (id -> name) — payloads carry exerciseIds, not TE ids.
  const exerciseNameById = new Map<string, string>();
  for (const day of share.routine.days) {
    for (const te of day.template.exercises) {
      exerciseNameById.set(te.exerciseId, te.exercise.name);
    }
  }
  // Suggestions can reference exercises NOT on the routine (e.g. swap_anyof
  // candidates, custom_exercise suggestions). Fetch the rest in one round
  // trip so we can render full names.
  const referencedIds = new Set<string>();
  for (const s of activity.suggestions) {
    const p = s.payload as Record<string, unknown>;
    for (const key of ['outExerciseId', 'inExerciseId']) {
      const v = p[key];
      if (typeof v === 'string') referencedIds.add(v);
    }
    for (const key of ['candidateIds', 'exerciseIds']) {
      const v = p[key];
      if (Array.isArray(v)) for (const id of v) if (typeof id === 'string') referencedIds.add(id);
    }
  }
  if (referencedIds.size > 0) {
    const rows = await db.exercise.findMany({
      where: { id: { in: Array.from(referencedIds) } },
      select: { id: true, name: true },
    });
    for (const r of rows) exerciseNameById.set(r.id, r.name);
  }

  // Day-level lookup so the owner can pick "insert custom into this day" etc.
  const dayChoices = share.routine.days.map((d) => ({
    id: d.id,
    name: d.template.name,
    position: d.position,
  }));

  return (
    <main className="px-5 py-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <Link href="/routine/shares" className="text-xs text-ink-400 hover:text-ink-200">
          ← all share links
        </Link>
        <h1 className="font-display text-2xl mt-1">
          {share.label ?? 'Share link'}
          {share.revokedAt && (
            <span className="ml-2 text-xs text-rose-300/80 uppercase tracking-wider">revoked</span>
          )}
        </h1>
        <div className="text-[11px] text-ink-500 mt-1 break-all">/share/{share.token}</div>
      </div>

      <ShareDetail
        shareId={share.id}
        comments={activity.comments.map((c) => ({
          id: c.id,
          reviewerName: c.reviewer.displayName,
          targetType: c.targetType,
          targetId: c.targetId,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          resolvedAt: c.resolvedAt?.toISOString() ?? null,
        }))}
        suggestions={activity.suggestions.map((s) => ({
          id: s.id,
          reviewerName: s.reviewer.displayName,
          kind: s.kind,
          targetType: s.targetType,
          targetId: s.targetId,
          payload: s.payload as Record<string, unknown>,
          state: s.state,
          createdAt: s.createdAt.toISOString(),
        }))}
        reactions={activity.reactions.map((r) => ({
          id: r.id,
          reviewerName: r.reviewer.displayName,
          targetType: r.targetType,
          targetId: r.targetId,
        }))}
        labelByTarget={Object.fromEntries(labels)}
        exerciseNameById={Object.fromEntries(exerciseNameById)}
        dayChoices={dayChoices}
      />
    </main>
  );
}
