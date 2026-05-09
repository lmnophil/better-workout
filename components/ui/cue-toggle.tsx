'use client';

// Quick mute toggles for rest-timer cues. Mounted in the app header so they're
// always one tap away — for the days you don't want anything beeping in the
// gym (or want to wake the apartment).
//
// Two independent buttons (sound, vibrate) so users can mute one without
// affecting the other. Granular control also lives on the settings page; the
// in-workout rest-timer bar exposes the same per-cue toggles. All three
// surfaces read/write the shared PrefsContext so they stay in sync.

import { Volume2, VolumeX, Vibrate, VibrateOff } from 'lucide-react';
import { usePrefs } from '@/components/ui/prefs-context';

export function CueToggle() {
  const { prefs, updatePrefs } = usePrefs();

  return (
    <div className="flex items-center">
      <button
        onClick={() => updatePrefs({ restTimerSound: !prefs.restTimerSound })}
        aria-label={prefs.restTimerSound ? 'Mute timer sound' : 'Unmute timer sound'}
        aria-pressed={prefs.restTimerSound}
        title={prefs.restTimerSound ? 'Sound on — tap to mute' : 'Sound off — tap to enable'}
        className="p-2 text-ink-500 hover:text-ink-100 transition"
      >
        {prefs.restTimerSound ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      <button
        onClick={() => updatePrefs({ restTimerVibrate: !prefs.restTimerVibrate })}
        aria-label={prefs.restTimerVibrate ? 'Disable timer vibration' : 'Enable timer vibration'}
        aria-pressed={prefs.restTimerVibrate}
        title={prefs.restTimerVibrate ? 'Vibrate on — tap to disable' : 'Vibrate off — tap to enable'}
        className="p-2 text-ink-500 hover:text-ink-100 transition"
      >
        {prefs.restTimerVibrate ? <Vibrate size={18} /> : <VibrateOff size={18} />}
      </button>
    </div>
  );
}
