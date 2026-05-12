'use client';

// Rest timer preferences UI for the settings page. Reads/writes via the
// shared PrefsContext, so toggles here reflect immediately in the workout
// page's rest-timer bar and the header's cue toggle (and vice versa).

import { useState } from 'react';
import { usePrefs } from '@/components/ui/prefs-context';

const DURATION_PRESETS = [30, 60, 90, 120, 180, 240];

export function RestTimerEditor() {
  const { prefs, updatePrefs } = usePrefs();
  const [customOpen, setCustomOpen] = useState(!DURATION_PRESETS.includes(prefs.restTimerSeconds));
  const [customValue, setCustomValue] = useState(String(prefs.restTimerSeconds));

  function pickPreset(seconds: number) {
    setCustomOpen(false);
    updatePrefs({ restTimerSeconds: seconds });
  }

  function commitCustom() {
    const n = Number.parseInt(customValue, 10);
    if (!Number.isFinite(n) || n < 5 || n > 600) return;
    updatePrefs({ restTimerSeconds: n });
  }

  return (
    <div className="space-y-1.5">
      {/* Enabled toggle */}
      <Row label="Auto-start after sets" description="Start a rest countdown when you log reps.">
        <Toggle
          checked={prefs.restTimerEnabled}
          onChange={(v) => updatePrefs({ restTimerEnabled: v })}
          label="Auto-start rest timer"
        />
      </Row>

      {/* Duration */}
      <Row label="Default rest" description="Tap a preset or set your own.">
        <div className="flex flex-wrap gap-1.5 justify-end">
          {DURATION_PRESETS.map((s) => {
            const active = !customOpen && prefs.restTimerSeconds === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => pickPreset(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  active
                    ? 'accent-bg text-ink-950 border-transparent'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600'
                }`}
              >
                {s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}m` : `${(s / 60).toFixed(1)}m`}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCustomOpen((c) => !c)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              customOpen
                ? 'accent-bg text-ink-950 border-transparent'
                : 'border-ink-800 text-ink-300 hover:border-ink-600'
            }`}
          >
            Custom
          </button>
        </div>
      </Row>

      {/* Custom duration input — only visible when "Custom" is active */}
      {customOpen && (
        <div className="px-4 py-2.5 flex items-center gap-2 bg-ink-900/40 rounded-lg">
          <label
            htmlFor="custom-rest"
            className="text-[10px] tracking-[0.2em] uppercase text-ink-400"
          >
            Seconds
          </label>
          <input
            id="custom-rest"
            type="number"
            min={5}
            max={600}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-20 bg-ink-900 border border-ink-800 rounded px-2 py-1 text-sm font-mono text-right focus:outline-none focus:border-accent/50"
          />
          <span className="text-[10px] text-ink-600">5–600</span>
        </div>
      )}

      {/* Sound */}
      <Row label="Chime when done" description="Two-tone audio cue at the end of each rest.">
        <Toggle
          checked={prefs.restTimerSound}
          onChange={(v) => updatePrefs({ restTimerSound: v })}
          label="Play sound"
        />
      </Row>

      {/* Vibrate */}
      <Row label="Vibrate when done" description="Mobile devices only.">
        <Toggle
          checked={prefs.restTimerVibrate}
          onChange={(v) => updatePrefs({ restTimerVibrate: v })}
          label="Vibrate"
        />
      </Row>
    </div>
  );
}

// ============ ROW + TOGGLE PRIMITIVES ============

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

function Toggle({
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
