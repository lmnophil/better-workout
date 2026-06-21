'use client';

// Rest timer preferences UI for the settings page. Reads/writes via the
// shared PrefsContext, so toggles here reflect immediately in the workout
// page's rest-timer bar and the header's cue toggle (and vice versa).

import { useState } from 'react';
import { usePrefs } from '@/components/ui/prefs-context';
import { Row, Toggle, CustomNumberField } from './settings-controls';

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
        <CustomNumberField
          id="custom-rest"
          label="Seconds"
          value={customValue}
          onChange={setCustomValue}
          onCommit={commitCustom}
          min={5}
          max={600}
          hint="5–600"
        />
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
