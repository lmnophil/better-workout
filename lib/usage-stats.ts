// Exercise metadata + usage-stat shapes shared across the workout UI, the
// routine editor, and the routine timeline — plus the helper that rehydrates a
// serialized usage-stat list into the Map the exercise picker consumes.
//
// These live in lib/ rather than in workout-view.tsx for two reasons:
//   - The routine editor and timeline need them, and importing them from
//     workout-view created a workout-view ↔ routine-timeline import cycle and
//     dragged the whole session-UI module graph into the /routine client
//     bundle. A neutral lib module breaks both.
//   - ExerciseUsageStat used to live in lib/queries.ts (server-only). Client
//     files importing it from there skirted the "don't import queries.ts into
//     client components" rule, so the type moved here too. queries.ts now
//     imports it back from this module.

export type ExerciseInfo = {
  id: string;
  name: string;
  module: string;
  prescription: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  videoUrl: string | null;
  isCustom: boolean;
  // 'reps' (the default) or 'time'. Determines which input the set row renders.
  metric: string;
  // 'weight' (the default), 'band', or 'none'. Determines whether the set row
  // shows a numeric weight stepper, a band-strength chip selector, or hides
  // the load column entirely. See Exercise.loadType in schema.prisma.
  loadType: string;
  // Equipment tokens. Used by the routine preset picker; the active session UI
  // doesn't filter on it.
  equipment: string[];
  // Per-user rest timer override; null = use the global default from preferences
  restTimerSecondsOverride: number | null;
  // Per-user weight stepper override; null = use the global default
  weightIncrementOverride: number | null;
};

// Per-exercise usage stat in its resolved (in-memory) form: a real Date plus
// the trailing-year session count. This is the Map value the ExercisePicker
// reads to render the "12d ago · 8×" recency hint.
export type ExerciseUsageStat = { lastDoneDate: Date; sessionCount: number };

// The serialized (server→client) form of a usage stat: the date is an ISO
// string. Server pages ship a list of these; buildUsageStatsMap rehydrates
// them into the Map<exerciseId, ExerciseUsageStat> the picker wants. Lives
// here because the picker, the routine editor, and the routine timeline all
// consume it.
export type ExerciseUsageStatClient = {
  exerciseId: string;
  lastDoneDate: string; // ISO
  sessionCount: number;
};

export function buildUsageStatsMap(
  stats: ExerciseUsageStatClient[],
): Map<string, ExerciseUsageStat> {
  return new Map(
    stats.map((s) => [
      s.exerciseId,
      { lastDoneDate: new Date(s.lastDoneDate), sessionCount: s.sessionCount },
    ]),
  );
}
