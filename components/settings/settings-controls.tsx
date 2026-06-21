'use client';

// Shared building blocks for the settings editors. The rest-timer and
// workout-defaults editors had byte-identical copies of Row, the on/off
// Toggle, and the "Custom" numeric-entry block; they live here now so the
// three can't drift apart.

import type { ReactNode } from 'react';

// A labelled settings line: title + optional description on the left, a control
// on the right.
export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
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

// On/off switch. `label` is the accessible name (the visible label lives on the
// enclosing Row).
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full border transition ${
        checked ? 'accent-bg border-transparent' : 'bg-ink-900 border-ink-800'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
          checked ? 'bg-ink-950 translate-x-4' : 'bg-ink-500 translate-x-0'
        }`}
      />
    </button>
  );
}

// The "Custom" numeric-entry strip shown when a preset row's Custom pill is
// active. Commits on blur and on Enter (which blurs). The caller owns the
// string value, the commit, and the open/closed condition.
export function CustomNumberField({
  id,
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  min: number;
  max: number;
  step?: number;
  hint: string;
}) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-2 bg-ink-900/40 rounded-lg">
      <label htmlFor={id} className="text-[10px] tracking-[0.2em] uppercase text-ink-400">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        className="w-20 bg-ink-900 border border-ink-800 rounded px-2 py-1 text-sm font-mono text-right focus:outline-none focus:border-accent/50"
      />
      <span className="text-[10px] text-ink-600">{hint}</span>
    </div>
  );
}
