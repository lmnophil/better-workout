// Share management — list all share links the user has minted, with a button
// to mint a new one and a per-row revoke. Each row links into the detail
// page where the owner reviews suggestions.

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { headers } from 'next/headers';
import { getRoutineSharesForUser } from '@/lib/queries';
import { db } from '@/lib/db';
import { SharesIndex } from '@/components/share-owner/shares-index';

export const metadata = { title: 'Share routine — Tracker' };

export default async function RoutineSharesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [shares, routine, h] = await Promise.all([
    getRoutineSharesForUser(userId),
    db.routine.findUnique({ where: { userId }, select: { id: true, name: true } }),
    headers(),
  ]);

  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = host ? `${proto}://${host}` : '';

  return (
    <main className="px-5 py-6 max-w-2xl mx-auto">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
            Share your routine
          </div>
          <h1 className="font-display text-2xl">
            {routine?.name ?? 'No routine yet'}
          </h1>
        </div>
        <Link href="/routine" className="text-xs text-ink-400 hover:text-ink-200">
          back to routine
        </Link>
      </div>

      {!routine && (
        <p className="text-ink-300 text-sm">
          You don’t have a routine yet — build one on the{' '}
          <Link href="/routine" className="underline">
            routine page
          </Link>{' '}
          before minting a share link.
        </p>
      )}

      {routine && (
        <SharesIndex
          baseUrl={baseUrl}
          shares={shares.map((s) => ({
            id: s.id,
            token: s.token,
            label: s.label,
            createdAt: s.createdAt.toISOString(),
            revokedAt: s.revokedAt?.toISOString() ?? null,
            counts: {
              reviewers: s._count.reviewers,
              comments: s._count.comments,
              suggestions: s._count.suggestions,
              reactions: s._count.reactions,
            },
          }))}
        />
      )}
    </main>
  );
}
