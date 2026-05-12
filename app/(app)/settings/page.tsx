// Settings page. Currently houses the volume target overrides; future settings
// (notification preferences, units, theme) can slot in alongside.

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getUserVolumeTargets, getHiddenBuiltinTemplates } from '@/lib/queries';
import { MUSCLE_GROUPS } from '@/lib/exercises-data';
import { VolumeTargetsEditor } from '@/components/settings/volume-targets-editor';
import { RestTimerEditor } from '@/components/settings/rest-timer-editor';
import { WorkoutDefaultsEditor } from '@/components/settings/workout-defaults-editor';
import { HiddenTemplatesEditor } from '@/components/settings/hidden-templates-editor';

export const metadata = { title: 'Settings — Tracker' };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const userId = session.user.id;

  const [overrides, hiddenTemplates] = await Promise.all([
    getUserVolumeTargets(userId),
    getHiddenBuiltinTemplates(userId),
  ]);

  const hiddenForClient = hiddenTemplates.map((row) => ({
    templateId: row.template.id,
    name: row.template.name,
    description: row.template.description,
    exerciseCount: row.template.exercises.length,
  }));

  // Only show muscles that have a default target (lifting muscles, not mobility/balance)
  const trackable = MUSCLE_GROUPS.filter(
    (m): m is typeof m & { weeklyVolumeTarget: number } => m.weeklyVolumeTarget !== undefined,
  ).map((m) => ({
    id: m.id,
    label: m.label,
    category: m.category,
    defaultTarget: m.weeklyVolumeTarget,
    currentTarget: overrides.get(m.id) ?? m.weeklyVolumeTarget,
    isOverridden: overrides.has(m.id),
  }));

  return (
    <div className="px-5 pt-6 pb-10">
      <div className="mb-6">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">Preferences</div>
        <h1
          className="font-display text-3xl tracking-tight"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          Settings
        </h1>
      </div>

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="font-display text-xl">Rest timer</h2>
          <p className="text-xs text-ink-400 italic font-display mt-1 leading-relaxed">
            Auto-starts when you log reps for a set. Tap the bar at the top of the workout to skip
            or extend.
          </p>
        </div>
        <RestTimerEditor />
      </section>

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="font-display text-xl">Workout defaults</h2>
          <p className="text-xs text-ink-400 italic font-display mt-1 leading-relaxed">
            How sets get seeded for new exercises and how big the weight stepper&apos;s +/- buttons
            jump. Override per-exercise from the workout view.
          </p>
        </div>
        <WorkoutDefaultsEditor />
      </section>

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="font-display text-xl">Weekly volume targets</h2>
          <p className="text-xs text-ink-400 italic font-display mt-1 leading-relaxed">
            How many sets per week you&apos;re aiming to hit each muscle group. Defaults are
            middle-of-the-road hypertrophy targets — adjust them to your goals.
          </p>
        </div>
        <VolumeTargetsEditor muscles={trackable} />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="font-display text-xl">Hidden default templates</h2>
          <p className="text-xs text-ink-400 italic font-display mt-1 leading-relaxed">
            Default templates you&apos;ve hidden from the workout page. Bring any back here.
          </p>
        </div>
        <HiddenTemplatesEditor templates={hiddenForClient} />
      </section>
    </div>
  );
}
