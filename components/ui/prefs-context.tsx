'use client';

// Preferences context — single source of truth for the rest-timer prefs
// across components in different layout layers (the cue toggle in the layout
// header, the rest timer + toggles in the workout page).
//
// Without this, each component had its own `useState(initialPrefs)` mirror
// and they could disagree until the next full revalidation. Now they share
// one state, and any consumer's update reflects everywhere immediately.
//
// The actual persistence still happens via `updateUserPreferences` server
// action — the context is just the in-memory shared state.

import { createContext, useContext, useState, ReactNode, useTransition } from 'react';
import { updateUserPreferences } from '@/lib/actions';
import type { RestTimerPrefs } from '@/components/workout/rest-timer';

type PrefsContextShape = {
  prefs: RestTimerPrefs;
  /** Apply a partial update locally + persist via server action. */
  updatePrefs: (patch: Partial<RestTimerPrefs>) => void;
};

const PrefsContext = createContext<PrefsContextShape | null>(null);

export function PrefsProvider({
  initial,
  children,
}: {
  initial: RestTimerPrefs;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [, startTransition] = useTransition();

  const updatePrefs = (patch: Partial<RestTimerPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    startTransition(() => {
      updateUserPreferences(patch);
    });
  };

  return (
    <PrefsContext.Provider value={{ prefs, updatePrefs }}>
      {children}
    </PrefsContext.Provider>
  );
}

/**
 * Read + update the user's rest-timer preferences. Throws if used outside the
 * provider — surfacing the bug at dev time rather than rendering broken UI.
 */
export function usePrefs(): PrefsContextShape {
  const ctx = useContext(PrefsContext);
  if (ctx === null) {
    throw new Error('usePrefs must be used inside <PrefsProvider>');
  }
  return ctx;
}
