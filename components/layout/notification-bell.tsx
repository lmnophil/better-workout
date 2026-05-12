// Bell icon in the app header. Server component — fetches the unread count
// inline so initial render shows the badge immediately, no client refetch
// needed. The link target is /notifications; the dropdown UX is deferred to
// the inbox page itself rather than a hover menu (less code, more affordance
// for keyboard users).

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { getUnreadNotificationCount } from '@/lib/queries';

export async function NotificationBell({ userId }: { userId: string }) {
  const count = await getUnreadNotificationCount(userId);
  return (
    <Link
      href="/notifications"
      aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
      className="relative p-2 text-ink-400 hover:text-ink-100 transition"
    >
      <Bell size={16} />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-amber-400 text-ink-950 text-[9px] font-medium flex items-center justify-center"
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
