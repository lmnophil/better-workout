'use client';

// Picker for the user's volume tier preset. Scales every muscle's (min,
// target) bound — the user can still set per-muscle overrides on top via
// VolumeTargetsEditor below. Three options: maintenance / balanced / athlete.

import { usePrefs } from '@/components/ui/prefs-context';
import {
  VOLUME_TIERS,
  VOLUME_TIER_DESCRIPTIONS,
  VOLUME_TIER_LABELS,
  type VolumeTier,
} from '@/lib/coverage';

export function VolumeTierEditor() {
  const { prefs, updatePrefs } = usePrefs();

  return (
    <div className="space-y-1.5">
      {VOLUME_TIERS.map((tier) => {
        const active = prefs.volumeTier === tier;
        return (
          <button
            key={tier}
            type="button"
            onClick={() => {
              if (!active) updatePrefs({ volumeTier: tier as VolumeTier });
            }}
            aria-pressed={active}
            className={`block w-full text-left px-4 py-2.5 rounded-lg border transition ${
              active
                ? 'border-accent/60 bg-accent/10'
                : 'border-ink-800 bg-ink-900/30 hover:border-ink-600'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-ink-100">{VOLUME_TIER_LABELS[tier]}</span>
              {active && (
                <span className="text-[10px] tracking-wider uppercase text-accent shrink-0">
                  Active
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-400 italic font-display mt-0.5 leading-relaxed">
              {VOLUME_TIER_DESCRIPTIONS[tier]}
            </p>
          </button>
        );
      })}
    </div>
  );
}
