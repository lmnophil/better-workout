'use client';

import Link from 'next/link';
import { markNotificationsRead } from '@/lib/actions';
import { useAction } from '@/components/ui/use-action';

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationsList({ items }: { items: Item[] }) {
  const { run, isPending } = useAction();
  const unreadCount = items.filter((i) => !i.readAt).length;

  if (items.length === 0) {
    return (
      <div className="text-ink-400 text-sm py-12 text-center">
        Nothing here yet. Share your routine for review to get feedback.
      </div>
    );
  }

  const markAll = () => run(() => markNotificationsRead({ all: true }));

  return (
    <>
      {unreadCount > 0 && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            disabled={isPending}
            onClick={markAll}
            className="text-xs text-ink-300 hover:text-ink-100 disabled:opacity-50"
          >
            mark all read
          </button>
        </div>
      )}
      <ul className="space-y-1">
        {items.map((n) => (
          <li
            key={n.id}
            className={`border rounded-md ${
              n.readAt ? 'border-ink-800 bg-ink-900/30' : 'border-amber-400/40 bg-amber-400/5'
            }`}
          >
            <Link
              href={n.url}
              onClick={() => {
                if (!n.readAt) {
                  // Best-effort mark-read on click; the destination page also revalidates.
                  markNotificationsRead({ ids: [n.id] }).catch(() => {});
                }
              }}
              className="block px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm text-ink-100 font-medium">{n.title}</div>
                <div className="text-[10px] text-ink-500">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
              {n.body && <div className="text-xs text-ink-300 mt-0.5">{n.body}</div>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
