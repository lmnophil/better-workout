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
import { Row, CustomNumberField } from './settings-controls';

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
        <CustomNumberField
          id="custom-increment"
          label="Step"
          value={customIncrement}
          onChange={setCustomIncrement}
          onCommit={commitCustomIncrement}
          min={0.25}
          max={50}
          step={0.25}
          hint="0.25–50"
        />
      )}
    </div>
  );
}
