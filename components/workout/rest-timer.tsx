'use client';

// Rest timer — hook + bar component.
//
// Design notes:
//   - Tracks an absolute deadline (Date.now() + duration) rather than counting
//     down a tick at a time. Robust to tab backgrounding, setInterval drift,
//     and laptop sleep. When the user comes back, the time-remaining is correct.
//   - When the deadline passes, plays a chime (Web Audio) and vibrates (mobile).
//     Both gated by user preferences. Toggleable directly from the bar.
//   - Manual controls: skip (cancel), +30s (extend), reset to default.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Plus, Pause, Volume2, VolumeX, Vibrate } from 'lucide-react';
import type { UserPrefs } from '@/lib/prefs';

// The rest-timer reads only its own subset of UserPrefs. Kept as an alias so
// the hook signature stays narrow without requiring the full prefs object.
export type RestTimerPrefs = Pick<
  UserPrefs,
  'restTimerEnabled' | 'restTimerSeconds' | 'restTimerSound' | 'restTimerVibrate'
>;

export type RestTimerControls = {
  active: boolean;
  remainingSec: number;
  totalSec: number;
  start: (durationSec?: number) => void;
  skip: () => void;
  extend: (deltaSec: number) => void;
};

export function useRestTimer(prefs: RestTimerPrefs): RestTimerControls {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [totalSec, setTotalSec] = useState(prefs.restTimerSeconds);
  const [now, setNow] = useState(() => Date.now());
  const finishedFor = useRef<number | null>(null);

  // Tick the displayed `now` while a timer is running. 250ms gives smooth-enough
  // updates without burning cycles.
  useEffect(() => {
    if (endsAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [endsAt]);

  // Detect timer completion. We use `finishedFor` to make sure we only fire
  // the chime once per timer run, even if React re-renders.
  useEffect(() => {
    if (endsAt !== null && now >= endsAt && finishedFor.current !== endsAt) {
      finishedFor.current = endsAt;
      if (prefs.restTimerSound) playChime();
      if (prefs.restTimerVibrate) tryVibrate([200, 100, 200, 100, 400]);
      setEndsAt(null);
    }
  }, [endsAt, now, prefs.restTimerSound, prefs.restTimerVibrate]);

  const start = useCallback(
    (durationSec?: number) => {
      const total = durationSec ?? prefs.restTimerSeconds;
      if (total <= 0) return;
      setTotalSec(total);
      setEndsAt(Date.now() + total * 1000);
    },
    [prefs.restTimerSeconds],
  );

  const skip = useCallback(() => {
    setEndsAt(null);
  }, []);

  // Track the current deadline in a ref alongside the state so callbacks can
  // read it without depending on (and re-binding to) the state value.
  const endsAtRef = useRef<number | null>(null);
  useEffect(() => {
    endsAtRef.current = endsAt;
  }, [endsAt]);

  const extend = useCallback((deltaSec: number) => {
    if (endsAtRef.current === null) return; // no-op when timer is idle
    setEndsAt((current) => (current === null ? null : current + deltaSec * 1000));
    setTotalSec((t) => t + deltaSec);
  }, []);

  const remainingSec =
    endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));

  return {
    active: endsAt !== null,
    remainingSec,
    totalSec,
    start,
    skip,
    extend,
  };
}

// ============ AUDIO + VIBRATION HELPERS ============

// Single shared AudioContext, lazily created. Browsers cap concurrent contexts
// (~6 in most browsers); creating one per chime would exhaust the limit during
// a long workout. We keep one alive for the page's lifetime and reuse it.
let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedAudioCtx = new Ctor();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function playChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    // Some browsers suspend the context when created without a user gesture.
    // Resume is a no-op if already running, and harmless otherwise.
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    // Short two-tone chime — pleasant, attention-grabbing, not jarring
    playTone(ctx, 880, ctx.currentTime, 0.18); // A5
    playTone(ctx, 1175, ctx.currentTime + 0.15, 0.25); // D6
  } catch {
    // Silent failure — visual indicator + vibration still fire.
  }
}

function playTone(ctx: AudioContext, freq: number, when: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, when);
  gain.gain.exponentialRampToValueAtTime(0.25, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.05);
}

function tryVibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some platforms throw when called outside user gestures — ignore
    }
  }
}

// ============ TIMER BAR UI ============

export function RestTimerBar({
  controls,
  prefs,
  onToggleSound,
  onToggleVibrate,
}: {
  controls: RestTimerControls;
  prefs: RestTimerPrefs;
  onToggleSound: () => void;
  onToggleVibrate: () => void;
}) {
  if (!controls.active) return null;

  const { remainingSec, totalSec, skip, extend } = controls;
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const progressPct = totalSec > 0 ? ((totalSec - remainingSec) / totalSec) * 100 : 0;

  return (
    <div
      className="sticky top-0 z-20 bg-ink-900 border-b accent-border"
      role="timer"
      aria-live="off"
      aria-label={`Rest timer: ${label} remaining`}
    >
      {/* Progress fill */}
      <div className="absolute inset-x-0 top-0 h-full pointer-events-none">
        <div
          className="h-full accent-bg/10 transition-[width] duration-200 ease-linear"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="relative flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2">
          <Pause size={14} className="accent-text" />
          <span className="text-[10px] tracking-[0.25em] uppercase text-ink-300">
            Rest
          </span>
          <span className="font-mono text-base accent-text tabular-nums">{label}</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Quick toggles — tap to flip the persistent preference */}
          <button
            type="button"
            onClick={onToggleSound}
            className={`p-1.5 transition ${
              prefs.restTimerSound
                ? 'accent-text'
                : 'text-ink-600 hover:text-ink-400'
            }`}
            aria-label={prefs.restTimerSound ? 'Mute chime' : 'Unmute chime'}
            aria-pressed={prefs.restTimerSound}
            title={prefs.restTimerSound ? 'Sound on' : 'Sound off'}
          >
            {prefs.restTimerSound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            type="button"
            onClick={onToggleVibrate}
            className={`p-1.5 transition ${
              prefs.restTimerVibrate
                ? 'accent-text'
                : 'text-ink-600 hover:text-ink-400'
            }`}
            aria-label={prefs.restTimerVibrate ? 'Disable vibration' : 'Enable vibration'}
            aria-pressed={prefs.restTimerVibrate}
            title={prefs.restTimerVibrate ? 'Vibrate on' : 'Vibrate off'}
          >
            <Vibrate size={14} className={prefs.restTimerVibrate ? '' : 'opacity-50'} />
          </button>

          <span className="w-px h-4 bg-ink-800 mx-1" />

          <button
            type="button"
            onClick={() => extend(30)}
            className="text-xs px-2 py-1 text-ink-300 hover:text-ink-100 transition flex items-center gap-1"
            aria-label="Add 30 seconds"
          >
            <Plus size={12} />
            30s
          </button>
          <button
            type="button"
            onClick={skip}
            className="text-xs px-2 py-1 text-ink-300 hover:text-ink-100 transition flex items-center gap-1"
            aria-label="Skip rest timer"
          >
            <X size={12} />
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
