'use client';

// Workout defaults editor — drives two prefs that shape the active-workout
// experience without being part of the rest-timer cluster:
//   - defaultSetsPerExercise: how many empty sets are pre-created when an
//     exercise is added with no prior history. History wins when present.
//   - defaultWeightIncrement: how much the +/- buttons next to the weight
//     input nudge by. Per-exercise overrides live on each exercise card.
//
// Reads/writes via the shared PrefsContext, so the workout view sees changes
// immediately without a page refresh.

import { useState } from 'react';
import { usePrefs } from '@/components/ui/prefs-context';

const SETS_PRESETS = [1, 2, 3, 4, 5];
const INCREMENT_PRESETS = [1, 2.5, 5, 10];

export function WorkoutDefaultsEditor() {
  const { prefs, updatePrefs } = usePrefs();
  const [customIncrementOpen, setCustomIncrementOpen] = useState(
    !INCREMENT_PRESETS.includes(prefs.defaultWeightIncrement),
  );
  const [customIncrement, setCustomIncrement] = useState(String(prefs.defaultWeightIncrement));

  function pickSets(n: number) {
    updatePrefs({ defaultSetsPerExercise: n });
  }

  function pickIncrement(n: number) {
    setCustomIncrementOpen(false);
    updatePrefs({ defaultWeightIncrement: n });
  }

  function commitCustomIncrement() {
    const n = Number.parseFloat(customIncrement);
    if (!Number.isFinite(n) || n < 0.25 || n > 50) return;
    updatePrefs({ defaultWeightIncrement: n });
  }

  return (
    <div className="space-y-1.5">
      <Row
        label="Default sets per exercise"
        description="When you add an exercise with no prior history, this many empty sets are seeded. Once you've done it before, last-time wins."
      >
        <div className="flex flex-wrap gap-1.5 justify-end">
          {SETS_PRESETS.map((n) => {
            const active = prefs.defaultSetsPerExercise === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => pickSets(n)}
                className={`text-xs px-2.5 py-1 rounded-full border transition min-w-[2.25rem] ${
                  active
                    ? 'accent-bg text-ink-950 border-transparent'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </Row>

      <Row
        label="Default weight increment"
        description="The +/- buttons on each set nudge the weight by this much. Override per-exercise from the workout view."
      >
        <div className="flex flex-wrap gap-1.5 justify-end">
          {INCREMENT_PRESETS.map((n) => {
            const active = !customIncrementOpen && prefs.defaultWeightIncrement === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => pickIncrement(n)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  active
                    ? 'accent-bg text-ink-950 border-transparent'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600'
                }`}
              >
                {Number.isInteger(n) ? n : n}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCustomIncrementOpen((c) => !c)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              customIncrementOpen
                ? 'accent-bg text-ink-950 border-transparent'
                : 'border-ink-800 text-ink-300 hover:border-ink-600'
            }`}
          >
            Custom
          </button>
        </div>
      </Row>

      {customIncrementOpen && (
        <div className="px-4 py-2.5 flex items-center gap-2 bg-ink-900/40 rounded-lg">
          <label
            htmlFor="custom-increment"
            className="text-[10px] tracking-[0.2em] uppercase text-ink-400"
          >
            Step
          </label>
          <input
            id="custom-increment"
            type="number"
            min={0.25}
            max={50}
            step={0.25}
            value={customIncrement}
            onChange={(e) => setCustomIncrement(e.target.value)}
            onBlur={commitCustomIncrement}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-20 bg-ink-900 border border-ink-800 rounded px-2 py-1 text-sm font-mono text-right focus:outline-none focus:border-accent/50"
          />
          <span className="text-[10px] text-ink-600">0.25–50</span>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 px-4 bg-ink-900/30 rounded-lg">
      <div className="min-w-0">
        <div className="text-sm text-ink-100">{label}</div>
        {description && (
          <div className="text-[11px] text-ink-500 italic font-display mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
