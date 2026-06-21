'use client';

// Volume target editor. Each row is a muscle with an editable sets/week number.
// Local state mirrors the input; commit happens on blur. "Reset" clears the
// override and falls back to the default target.

import { useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';
import { setVolumeTarget, resetVolumeTarget } from '@/lib/actions';
import { useAction } from '@/components/ui/use-action';

type MuscleSetting = {
  id: string;
  label: string;
  category: string;
  defaultTarget: number;
  currentTarget: number;
  isOverridden: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  lower: 'Lower body',
  upper: 'Upper body',
  trunk: 'Core & trunk',
};

export function VolumeTargetsEditor({ muscles }: { muscles: MuscleSetting[] }) {
  // Group by category
  const grouped = new Map<string, MuscleSetting[]>();
  for (const m of muscles) {
    let bucket = grouped.get(m.category);
    if (!bucket) {
      bucket = [];
      grouped.set(m.category, bucket);
    }
    bucket.push(m);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
            {CATEGORY_LABELS[category] ?? category}
          </div>
          <div className="space-y-1.5">
            {items.map((m) => (
              <Row key={m.id} muscle={m} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ muscle }: { muscle: MuscleSetting }) {
  const [value, setValue] = useState(muscle.currentTarget.toString());
  const [justSaved, setJustSaved] = useState(false);
  const { run } = useAction();

  function commit() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 50) {
      // Revert
      setValue(muscle.currentTarget.toString());
      return;
    }
    if (n === muscle.currentTarget) return;
    // Flash the saved check only when the write lands; revert the input if the
    // server rejects it, so the number shown always matches what's stored.
    run(() => setVolumeTarget({ muscleId: muscle.id, target: Math.round(n) }), {
      onSuccess: () => {
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1200);
      },
      onError: () => setValue(muscle.currentTarget.toString()),
    });
  }

  function handleReset() {
    if (!muscle.isOverridden) return;
    run(() => resetVolumeTarget({ muscleId: muscle.id }), {
      onSuccess: () => setValue(muscle.defaultTarget.toString()),
    });
  }

  return (
    <div className="border border-ink-800 rounded-lg px-3 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-100">{muscle.label}</div>
        <div className="text-[10px] text-ink-500 font-mono mt-0.5">
          default: {muscle.defaultTarget} sets/wk
          {muscle.isOverridden && <span className="accent-text ml-2">·custom</span>}
        </div>
      </div>

      {muscle.isOverridden && (
        <button
          onClick={handleReset}
          className="text-ink-500 hover:text-ink-100 transition p-1"
          aria-label="Reset to default"
          title="Reset to default"
        >
          <RotateCcw size={13} />
        </button>
      )}

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          min={0}
          max={50}
          className="w-14 bg-ink-950 border border-ink-800 rounded px-2 py-1.5 text-sm font-mono text-center focus:outline-none focus:border-accent/50"
        />
        <span className="text-[10px] text-ink-500 tracking-wider uppercase">sets/wk</span>
        {justSaved && <Check size={13} className="accent-text" />}
      </div>
    </div>
  );
}
