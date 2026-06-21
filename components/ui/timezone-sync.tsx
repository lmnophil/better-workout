'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TIMEZONE_COOKIE } from '@/lib/utils';

// Parks the browser's detected IANA timezone in the `tz` cookie so server
// components can resolve "today" in the user's zone (see lib/timezone.ts and the
// ADR in docs/decisions.md). Runs once on mount; when the stored value is absent
// or stale (first visit, or the user travelled) it rewrites the cookie and
// soft-refreshes so server-rendered day math — the routine's "today", recency
// labels — reflects the right zone immediately rather than on the next
// navigation. Renders nothing.
export function TimeZoneSync() {
  const router = useRouter();
  useEffect(() => {
    let tz: string;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!tz) return;
    const current = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${TIMEZONE_COOKIE}=`))
      ?.slice(TIMEZONE_COOKIE.length + 1);
    if (current && decodeURIComponent(current) === tz) return;
    document.cookie = `${TIMEZONE_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);
  return null;
}
