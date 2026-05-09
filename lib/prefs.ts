// User preferences shape.
//
// Single source of truth so the schema, queries, server action, and client
// context all reference one type. The component CLAUDE.md flagged that the
// pref shape was getting expensive to extend across four files; centralising
// it here makes adding future prefs a single edit in most cases.
//
// Persistence: lib/queries.ts#getUserPreferences (reads + defaults), and
// lib/actions.ts#updateUserPreferences (writes). Runtime context lives at
// components/ui/prefs-context.tsx.

export type UserPrefs = {
  // Rest timer
  restTimerEnabled: boolean;
  restTimerSeconds: number;
  restTimerSound: boolean;
  restTimerVibrate: boolean;

  // Set-seeding floor: when an exercise is added with no history, this many
  // empty SetLogs are pre-created.
  defaultSetsPerExercise: number;

  // Weight stepper: how much the +/- buttons next to the weight input nudge
  // the value by, when no per-exercise override is set.
  defaultWeightIncrement: number;
};

export const PREFS_DEFAULTS: UserPrefs = {
  restTimerEnabled: true,
  restTimerSeconds: 90,
  restTimerSound: true,
  restTimerVibrate: true,
  defaultSetsPerExercise: 3,
  defaultWeightIncrement: 5,
};
