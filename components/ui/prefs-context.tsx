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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { updateUserPreferences } from '@/lib/actions';
import type { UserPrefs } from '@/lib/prefs';

type PrefsContextShape = {
  prefs: UserPrefs;
  /** Apply a partial update locally + persist via server action. */
  updatePrefs: (patch: Partial<UserPrefs>) => void;
};

const PrefsContext = createContext<PrefsContextShape | null>(null);

export function PrefsProvider({
  initial,
  children,
}: {
  initial: UserPrefs;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [, startTransition] = useTransition();

  // Stable identity so consumers that depend on `updatePrefs` in an effect
  // don't re-fire whenever this provider re-renders.
  const updatePrefs = useCallback((patch: Partial<UserPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    startTransition(() => {
      updateUserPreferences(patch);
    });
  }, []);

  // Memo the context value so unchanged prefs don't churn the object identity.
  const value = useMemo(() => ({ prefs, updatePrefs }), [prefs, updatePrefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

/**
 * Read + update the user's preferences. Throws if used outside the provider —
 * surfacing the bug at dev time rather than rendering broken UI.
 */
export function usePrefs(): PrefsContextShape {
  const ctx = useContext(PrefsContext);
  if (ctx === null) {
    throw new Error('usePrefs must be used inside <PrefsProvider>');
  }
  return ctx;
}
