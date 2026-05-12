// Inbox page — lists every notification, newest unread first. Clicking a row
// navigates to the source (a share detail page); a "mark all read" affordance
// clears the badge in one go.

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getNotificationsForUser } from '@/lib/queries';
import { NotificationsList } from '@/components/notifications/notifications-list';

export const metadata = { title: 'Notifications — Tracker' };

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const items = await getNotificationsForUser(userId);

  return (
    <main className="px-5 py-6 max-w-2xl mx-auto">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="font-display text-2xl">Notifications</h1>
        <Link href="/routine" className="text-xs text-ink-400 hover:text-ink-200">
          back to routine
        </Link>
      </div>
      <NotificationsList
        items={items.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          url: n.url,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
