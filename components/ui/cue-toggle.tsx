'use client';

// Quick mute toggle for rest-timer cues (sound + vibration). Mounted in the
// app header so it's always one tap away — for the days you don't want
// anything beeping in the gym (or want to wake the apartment).
//
// One tap toggles both sound and vibrate together (the common case).
// Granular per-cue control still lives on the settings page.
//
// Reads from the shared PrefsContext so toggles in the timer bar (workout
// page) reflect here instantly, and vice versa.

import { Volume2, VolumeX } from 'lucide-react';
import { usePrefs } from '@/components/ui/prefs-context';

export function CueToggle() {
  const { prefs, updatePrefs } = usePrefs();

  // "Cues on" if either is on. One click = turn both off (or both on if they
  // were both off). Settings handles the asymmetric case.
  const anyOn = prefs.restTimerSound || prefs.restTimerVibrate;

  function toggle() {
    const next = !anyOn;
    updatePrefs({ restTimerSound: next, restTimerVibrate: next });
  }

  return (
    <button
      onClick={toggle}
      aria-label={anyOn ? 'Mute timer cues' : 'Unmute timer cues'}
      title={anyOn ? 'Cues on — tap to mute' : 'Cues off — tap to enable'}
      className="p-2 text-ink-500 hover:text-ink-100 transition"
    >
      {anyOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
    </button>
  );
}
