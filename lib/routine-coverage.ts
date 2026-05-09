// Routine coverage estimation — pure logic, no DB access.
//
// Given a draft routine (a list of days, each with a list of exercises and a
// planned set count per exercise), estimate per-muscle coverage so the wizard
// can flag gaps as the user assembles the routine.
//
// Weighting matches getWeeklyVolume in lib/queries.ts:
//   - primary muscle: 1.0 × sets
//   - secondary muscle: 0.5 × sets
//
// Sequence vs weekday is meaningful here. In weekday mode each day fires once
// per week, so the sum is real "sets per week" and we can compare against
// targets directly. In sequence mode we don't know the user's cadence, so we
// only report "sets per cycle" — flagging weekly gaps would be guessing.
// Muscles with zero work are still flagged as "unworked" since that's
// cadence-independent.

import { MUSCLE_GROUPS, type MuscleCategory } from './exercises-data';

export type DraftExercise = {
  primaryMuscles: string[];
  secondaryMuscles: string[];
  plannedSets: number;
};

export type DraftDay = {
  exercises: DraftExercise[];
};

export type CoverageStat = {
  muscleId: string;
  label: string;
  category: MuscleCategory;
  // Effective target (user override or default), null for muscles without one
  // (mobility, balance, cardio).
  target: number | null;
  // Total weighted sets across one full pass through the routine.
  setsPerCycle: number;
  // Weekday mode only: weekly volume (same as setsPerCycle since each day
  // fires once per week). Null in sequence mode — cadence is unknown.
  setsPerWeek: number | null;
  // Whether the muscle has any work in this routine. Cadence-independent.
  unworked: boolean;
  // Only meaningful in weekday mode with a target: 'under' or 'met'. Null
  // otherwise so the UI doesn't false-flag sequence routines.
  weekdayGap: 'under' | 'met' | null;
};

export function computeRoutineCoverage(
  days: DraftDay[],
  scheduleStyle: 'sequence' | 'weekday',
  targetOverrides: Map<string, number>,
): CoverageStat[] {
  const setsByMuscle = new Map<string, number>();
  for (const day of days) {
    for (const ex of day.exercises) {
      const sets = ex.plannedSets;
      for (const m of ex.primaryMuscles) {
        setsByMuscle.set(m, (setsByMuscle.get(m) ?? 0) + sets);
      }
      for (const m of ex.secondaryMuscles) {
        setsByMuscle.set(m, (setsByMuscle.get(m) ?? 0) + sets * 0.5);
      }
    }
  }

  return MUSCLE_GROUPS.map((group) => {
    const raw = setsByMuscle.get(group.id) ?? 0;
    const setsPerCycle = Math.round(raw * 10) / 10;
    const target = targetOverrides.get(group.id) ?? group.weeklyVolumeTarget ?? null;
    const setsPerWeek = scheduleStyle === 'weekday' ? setsPerCycle : null;
    const unworked = setsPerCycle === 0;
    let weekdayGap: 'under' | 'met' | null = null;
    if (setsPerWeek !== null && target !== null && target > 0) {
      weekdayGap = setsPerWeek >= target ? 'met' : 'under';
    }
    return {
      muscleId: group.id,
      label: group.label,
      category: group.category,
      target,
      setsPerCycle,
      setsPerWeek,
      unworked,
      weekdayGap,
    };
  });
}
