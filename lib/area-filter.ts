// Chip taxonomy and filter helpers for the exercise picker and the workout
// page's empty state. Both surfaces let the user narrow exercises by area,
// and both should render the exact same chip set in the exact same order, so
// the chip definitions live here in one place.
//
// Two chip layers:
//   - REGIONS: broad strokes (Upper / Lower / Full body / Mobility). The
//     "full" id is exclusive — selecting it cancels every other chip.
//   - MUSCLE_CHIPS: muscle groupings (Chest, Back, Arms, etc.). Each chip
//     maps to one or more MUSCLE_GROUPS ids — "Arms" expands to biceps +
//     triceps, "Back" gathers the upper-back muscles together — so a user
//     who taps "Back" sees lat work, scap work, and rear-delt work without
//     having to think about the underlying anatomy.
//
// Selection across both layers is unioned: an exercise matches if it hits
// any allowed muscle. Region chips and muscle chips combine the same way.
//
// The filter operates on the same shape we hand to the picker
// (ExerciseInfo), but typed loosely against the muscle arrays so the helper
// can be reused by anything else that has primary/secondary muscle lists.

import { MUSCLE_GROUPS } from './exercises-data';

// Compose a one-line hint for a chip listing the muscles it selects. Drawn
// from MUSCLE_GROUPS so we don't duplicate copy. Used by the picker's
// per-chip browser `title` and by any future tooltip surface that wants
// to surface chip scope.
export function chipMuscleHint(muscleIds: string[]): string {
  if (muscleIds.length === 0) return '';
  const labels = muscleIds
    .map((id) => MUSCLE_GROUPS.find((m) => m.id === id)?.label ?? id)
    .filter(Boolean);
  return `Includes: ${labels.join(', ')}`;
}

export type RegionChip = {
  id: 'upper' | 'lower' | 'full' | 'mobility';
  label: string;
};

export type MuscleChip = {
  id: string;
  label: string;
  // Muscle ids from MUSCLE_GROUPS that this chip selects. Multi-id chips
  // (e.g. "Arms" → biceps + triceps) collapse a few groups into one tap.
  muscles: string[];
};

export const REGIONS: RegionChip[] = [
  { id: 'upper', label: 'Upper' },
  { id: 'lower', label: 'Lower' },
  { id: 'full', label: 'Full body' },
  { id: 'mobility', label: 'Mobility' },
];

export const MUSCLE_CHIPS: MuscleChip[] = [
  { id: 'chest', label: 'Chest', muscles: ['chest'] },
  // "Back" is intentionally broad — most people thinking "back day" want lat
  // work, scapular work, rear delts, and lower back to all be in scope.
  {
    id: 'back',
    label: 'Back',
    muscles: ['back', 'lower back', 'rear delts', 'scapular', 'lower traps'],
  },
  { id: 'shoulders', label: 'Shoulders', muscles: ['shoulders'] },
  { id: 'arms', label: 'Arms', muscles: ['biceps', 'triceps'] },
  { id: 'glutes', label: 'Glutes', muscles: ['glutes'] },
  { id: 'quads', label: 'Quads', muscles: ['quads', 'adductors'] },
  { id: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'] },
  { id: 'core', label: 'Core', muscles: ['core'] },
];

// Cache the muscle id sets per region so matchesArea doesn't re-scan
// MUSCLE_GROUPS on every exercise filter call.
const MUSCLES_BY_REGION: Record<RegionChip['id'], Set<string>> = {
  upper: new Set(MUSCLE_GROUPS.filter((m) => m.category === 'upper').map((m) => m.id)),
  lower: new Set(MUSCLE_GROUPS.filter((m) => m.category === 'lower').map((m) => m.id)),
  mobility: new Set(MUSCLE_GROUPS.filter((m) => m.category === 'mobility').map((m) => m.id)),
  // "Full body" doesn't enumerate — it's a special case in matchesArea that
  // means "no filter". Keeping the set empty so a stray lookup doesn't pretend
  // otherwise.
  full: new Set(),
};

const MUSCLES_BY_CHIP: Map<string, Set<string>> = new Map(
  MUSCLE_CHIPS.map((c) => [c.id, new Set(c.muscles)]),
);

type MuscleSource = {
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

/**
 * Does the exercise belong to any of the selected areas?
 *
 * No chips selected → matches everything (trivial pass).
 * Region "full" selected → matches everything (full body = no filter).
 * Otherwise: union the allowed muscle ids from every selected region and
 * muscle chip, then return true iff the exercise hits any of them through
 * its primary OR secondary muscles. Both count, since chip-based browsing
 * is "what could I work right now," not strict primary-target lookup.
 */
export function matchesArea(
  exercise: MuscleSource,
  regionIds: string[],
  muscleChipIds: string[],
): boolean {
  if (regionIds.length === 0 && muscleChipIds.length === 0) return true;
  if (regionIds.includes('full')) return true;

  const allowed = new Set<string>();
  for (const regionId of regionIds) {
    const set = MUSCLES_BY_REGION[regionId as RegionChip['id']];
    if (set) for (const m of set) allowed.add(m);
  }
  for (const chipId of muscleChipIds) {
    const set = MUSCLES_BY_CHIP.get(chipId);
    if (set) for (const m of set) allowed.add(m);
  }
  if (allowed.size === 0) return true;

  for (const m of exercise.primaryMuscles) if (allowed.has(m)) return true;
  for (const m of exercise.secondaryMuscles) if (allowed.has(m)) return true;
  return false;
}

/**
 * Map a list of raw muscle ids back to the muscle chips that contain them.
 * Used when something needs to seed the picker's chip filter from an
 * exercise's primary muscles — e.g. the swap flow opens the picker
 * pre-filtered to the same muscle group as the exercise being replaced.
 */
export function muscleIdsToChipIds(muscleIds: string[]): string[] {
  const result = new Set<string>();
  for (const muscleId of muscleIds) {
    for (const chip of MUSCLE_CHIPS) {
      if (chip.muscles.includes(muscleId)) result.add(chip.id);
    }
  }
  return Array.from(result);
}

/**
 * Tally how many of the chosen exercises target each primary muscle.
 * Drives the "Targets:" line in the picker footer — gives the user a quick
 * sense of what they've stacked up before they commit.
 */
export function summariseTargets(exercises: MuscleSource[]): {
  primaryCounts: Map<string, number>;
} {
  const primaryCounts = new Map<string, number>();
  for (const ex of exercises) {
    for (const m of ex.primaryMuscles) {
      primaryCounts.set(m, (primaryCounts.get(m) ?? 0) + 1);
    }
  }
  return { primaryCounts };
}

/**
 * A soft nudge when a multi-pick selection looks lopsided. Returns a one-line
 * suggestion or null when nothing notable.
 *
 * This is a heuristic, not a recommendation engine — it only fires on
 * specific, obvious imbalances (push without pull, hinge without squat, etc.)
 * and stays quiet otherwise. Coverage is the real signal for "what should I
 * do today"; this is just a friendly check before commit.
 */
export function balanceHint(exercises: MuscleSource[]): string | null {
  if (exercises.length < 3) return null;

  const counts = summariseTargets(exercises).primaryCounts;
  const get = (id: string) => counts.get(id) ?? 0;

  const pushPrimary = get('chest') + get('shoulders') + get('triceps');
  const pullPrimary = get('back') + get('biceps') + get('rear delts');
  if (pushPrimary >= 2 && pullPrimary === 0) {
    return 'No pull movements yet — a row or pulldown would balance it.';
  }
  if (pullPrimary >= 2 && pushPrimary === 0) {
    return 'No push movements yet — a press would balance it.';
  }

  const quads = get('quads');
  const posterior = get('hamstrings') + get('glutes');
  if (quads >= 2 && posterior === 0) {
    return 'Quad-heavy — a hinge or hamstring movement would balance it.';
  }
  if (posterior >= 2 && quads === 0) {
    return 'Hinge-heavy — a squat would round it out.';
  }

  return null;
}
