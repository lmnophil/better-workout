// Coverage page. Server component — loads recency, volume, target overrides
// and tier preset in parallel, hands a flat shape per muscle to the client.

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import {
  getCoverageData,
  getWeeklyVolume,
  getUserVolumeTargets,
  getUserPreferences,
} from '@/lib/queries';
import { MUSCLE_GROUPS } from '@/lib/exercises-data';
import { effectiveBounds } from '@/lib/coverage';
import { CoverageView } from '@/components/coverage/coverage-view';
import { getRequestTimeZone } from '@/lib/timezone';

export const metadata = { title: 'Coverage — Tracker' };

export default async function CoveragePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [coverage, volume, overrides, prefs, timeZone] = await Promise.all([
    getCoverageData(userId),
    getWeeklyVolume(userId),
    getUserVolumeTargets(userId),
    getUserPreferences(userId),
    getRequestTimeZone(),
  ]);

  // Resolve (min, target) per muscle by combining the user's tier preset with
  // any per-muscle override. Sent to the client as a flat shape so the view
  // never re-derives bounds.
  const muscles = MUSCLE_GROUPS.map((m) => {
    const bounds = effectiveBounds(m, prefs.volumeTier, overrides.get(m.id));
    const lastWorked = coverage.get(m.id);
    return {
      id: m.id,
      label: m.label,
      category: m.category,
      lastWorked: lastWorked ? lastWorked.toISOString() : null,
      volumeThisWeek: volume.get(m.id) ?? 0,
      min: bounds?.min ?? null,
      target: bounds?.target ?? null,
      isOverridden: overrides.has(m.id),
    };
  });

  return <CoverageView muscles={muscles} tier={prefs.volumeTier} timeZone={timeZone} />;
}
