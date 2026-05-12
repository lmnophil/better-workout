// Shared coverage logic — used by /coverage (recency + weekly volume), the
// routine editor's CoveragePanel (structural per-cycle volume), the share
// view (read-only reviewer copy of the routine's coverage), and the
// suggestion-impact diff.
//
// Why centralize:
//   - Two surfaces (coverage view + routine editor) used to keep their own
//     tier-color tables and threshold helpers. They drifted in subtle ways.
//   - The new "tier preset" (maintenance / balanced / athlete) needs a single
//     resolver — adding it twice would invite the same drift.
//
// The volume model itself is unchanged from getWeeklyVolume / the editor's
// computeMuscleTotals: primary muscles get 1.0× sets, secondary get 0.5×.

import type { MuscleGroup } from './exercises-data';

// ============================================================
// VOLUME TIER PRESET
// ============================================================

export type VolumeTier = 'maintenance' | 'balanced' | 'athlete';

export const VOLUME_TIERS: VolumeTier[] = ['maintenance', 'balanced', 'athlete'];

export const VOLUME_TIER_LABELS: Record<VolumeTier, string> = {
  maintenance: 'Maintenance',
  balanced: 'Balanced',
  athlete: 'Athlete',
};

export const VOLUME_TIER_DESCRIPTIONS: Record<VolumeTier, string> = {
  maintenance:
    'Keeping fitness — short sessions, lower frequency. Targets and minimums halved.',
  balanced:
    'Moderate growth and strength — typical 3–5 day routines. The default for everyone.',
  athlete:
    'High volume — 5+ days, longer sessions. Pushes the target 50% higher while keeping the floor at the balanced target.',
};

// Multipliers applied to the canonical (min, target) pair on each muscle.
// 'balanced' is canonical (no scaling). 'maintenance' halves both. 'athlete'
// keeps the floor at today's target and pushes the stretch goal 50% higher,
// so high-volume lifters get a meaningful ceiling without changing the "you
// did enough" line.
const TIER_BOUNDS: Record<VolumeTier, { minMul: number; targetMul: number }> = {
  maintenance: { minMul: 0.5, targetMul: 0.5 },
  balanced: { minMul: 1.0, targetMul: 1.0 },
  athlete: { minMul: 1.0, targetMul: 1.5 },
};

export const DEFAULT_VOLUME_TIER: VolumeTier = 'balanced';

export function isVolumeTier(s: unknown): s is VolumeTier {
  return s === 'maintenance' || s === 'balanced' || s === 'athlete';
}

// ============================================================
// EFFECTIVE BOUNDS
// ============================================================

export type EffectiveBounds = { min: number; target: number };

type BoundsInput = Pick<MuscleGroup, 'minimumWeeklySets' | 'weeklyVolumeTarget'>;

// Resolve (min, target) for a muscle given the user's tier and any per-muscle
// override. Returns null for muscles tracked by recency only (mobility, balance,
// cardio).
//
// Per-muscle override (target only — there's no separate min override): we
// derive min as 50% of the override. The user is opting into a specific target
// number, so keeping min proportional is the least-surprising behaviour. If a
// user wants a finer-grained min, they can set the override to a smaller
// target and let the floor track it.
export function effectiveBounds(
  muscle: BoundsInput,
  tier: VolumeTier,
  override?: number,
): EffectiveBounds | null {
  if (override != null) {
    if (override <= 0) return null;
    return { min: Math.max(1, Math.round(override * 0.5)), target: override };
  }
  const baseTarget = muscle.weeklyVolumeTarget;
  if (baseTarget == null) return null;
  const baseMin = muscle.minimumWeeklySets ?? Math.round(baseTarget * 0.5);
  const t = TIER_BOUNDS[tier];
  return {
    min: Math.max(1, Math.round(baseMin * t.minMul)),
    target: Math.max(1, Math.round(baseTarget * t.targetMul)),
  };
}

// ============================================================
// COVERAGE TIERS (per-muscle status)
// ============================================================

// Tier states. The new 'ok' tier between 'under' and 'target' is the big
// philosophical change: a 4-day routine landing at 6/12 chest sets used to
// render red ("under") even though it's a solid maintenance dose. Now that's
// green ("ok"), and the brighter green is reserved for hitting the target.
//
// 'emphasis' is *informational*. Loading a muscle past 1.5× the target may be
// deliberate (specialization, lagging-part work) — we flag it so the user
// notices, but don't paint it red.
export type CoverageTier = 'gap' | 'under' | 'ok' | 'target' | 'emphasis' | 'untracked';

const EMPHASIS_FACTOR = 1.5;

export function tierFor(sets: number, bounds: EffectiveBounds | null): CoverageTier {
  if (bounds === null) return 'untracked';
  if (sets <= 0) return 'gap';
  if (sets >= bounds.target * EMPHASIS_FACTOR) return 'emphasis';
  if (sets >= bounds.target) return 'target';
  if (sets >= bounds.min) return 'ok';
  return 'under';
}

// Visual palette. RGBA inline so we don't need to plumb tailwind tokens
// through multiple surfaces. Mirrors the prior recency palette so the colour
// language stays consistent across /coverage and the routine editor.
//
// The blue 'emphasis' hue is deliberately *not* in the warm green→red gradient
// — emphasis isn't on the "more is better/worse" axis, it's a tag. Using a
// cool colour keeps the user from reading it as either good or bad.
export const TIER_VISUALS: Record<
  CoverageTier,
  { bg: string; border: string; bar: string; dot: string; label: string }
> = {
  target: {
    bg: 'rgba(132, 204, 22, 0.13)',
    border: 'rgba(132, 204, 22, 0.55)',
    bar: '#84cc16',
    dot: '#84cc16',
    label: 'On target',
  },
  ok: {
    bg: 'rgba(101, 153, 64, 0.10)',
    border: 'rgba(101, 153, 64, 0.45)',
    bar: '#659940',
    dot: '#659940',
    label: 'Good',
  },
  under: {
    bg: 'rgba(180, 100, 70, 0.12)',
    border: 'rgba(180, 100, 70, 0.5)',
    bar: '#b46446',
    dot: '#b46446',
    label: 'Below min',
  },
  gap: {
    bg: 'rgba(220, 80, 60, 0.13)',
    border: 'rgba(220, 80, 60, 0.6)',
    bar: '#dc503c',
    dot: '#dc503c',
    label: 'Gap',
  },
  emphasis: {
    bg: 'rgba(96, 154, 224, 0.10)',
    border: 'rgba(96, 154, 224, 0.5)',
    bar: '#609ae0',
    dot: '#609ae0',
    label: 'Emphasis',
  },
  untracked: {
    bg: 'rgba(60, 50, 45, 0.20)',
    border: 'rgba(60, 50, 45, 0.4)',
    bar: '#3a2f25',
    dot: '#3a2f25',
    label: 'Untracked',
  },
};

// ============================================================
// STRUCTURAL VOLUME COMPUTATION
// ============================================================

// Number of sets to assume when an exercise is on a routine day without a
// planned-sets value. Matches the seeder so time and coverage readouts agree.
export const ESTIMATED_SETS_FALLBACK = 3;

export type ExerciseMuscleShape = {
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

export type PlannedExercise = {
  exerciseId: string;
  plannedSets: number | null;
};

export type PlannedDay = {
  exercises: PlannedExercise[];
};

export type MuscleVolume = { sets: number; estimated: boolean };
export type MuscleVolumes = Map<string, MuscleVolume>;

// Sum weighted sets per muscle across one full routine cycle. Primary
// contributes 1.0 × sets, secondary 0.5 ×. An exercise with no planned-sets
// falls back to ESTIMATED_SETS_FALLBACK and the muscle gets the `estimated`
// flag so the UI can disclose where numbers are firm vs inferred.
export function computeRoutineVolumes(
  days: PlannedDay[],
  exerciseById: Map<string, ExerciseMuscleShape>,
): { totals: MuscleVolumes; anyEstimated: boolean } {
  const totals: MuscleVolumes = new Map();
  let anyEstimated = false;
  for (const day of days) {
    for (const dx of day.exercises) {
      const ex = exerciseById.get(dx.exerciseId);
      if (!ex) continue;
      const sets = dx.plannedSets ?? ESTIMATED_SETS_FALLBACK;
      const estimated = dx.plannedSets === null;
      if (estimated) anyEstimated = true;
      for (const m of ex.primaryMuscles) {
        const cur = totals.get(m) ?? { sets: 0, estimated: false };
        totals.set(m, { sets: cur.sets + sets, estimated: cur.estimated || estimated });
      }
      for (const m of ex.secondaryMuscles) {
        const cur = totals.get(m) ?? { sets: 0, estimated: false };
        totals.set(m, {
          sets: cur.sets + sets * 0.5,
          estimated: cur.estimated || estimated,
        });
      }
    }
  }
  return { totals, anyEstimated };
}

// Volume contribution from a single day. Caller is responsible for keeping
// context — a day's "5 sets of chest" is one day's worth, not weekly.
export function computeDayVolumes(
  day: PlannedDay,
  exerciseById: Map<string, ExerciseMuscleShape>,
): { totals: MuscleVolumes; anyEstimated: boolean } {
  return computeRoutineVolumes([day], exerciseById);
}

export function formatSets(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
