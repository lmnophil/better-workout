// Body-region color mapping for exercises and muscle categories.
//
// Color is the semantic axis the UI uses to differentiate work types at a
// glance — picker rows, exercise cards in a session, and coverage section
// headers all tint by region. The hex values themselves live in
// `tailwind.config.ts` under `colors.region.*`; this module is just the
// derivation rules and the Tailwind class strings.
//
// For mixed-region exercises (e.g. deadlift hits both lower and upper) we
// pick the *first* primary muscle's category. That matches "what this lift is
// known for" — the user named the primary muscle list in priority order, so
// the head of the list is the right anchor.

import { MUSCLE_GROUPS, type MuscleCategory } from './exercises-data';

// "core" reads better than "trunk" in UI copy; the schema uses "trunk" so we
// translate at the edges. Display labels and palette key both prefer "core".
export type Region = 'upper' | 'lower' | 'core' | 'mobility' | 'other';

const CATEGORY_TO_REGION: Record<MuscleCategory, Region> = {
  upper: 'upper',
  lower: 'lower',
  trunk: 'core',
  mobility: 'mobility',
  other: 'other',
};

/** Translate a schema `MuscleCategory` to the UI's `Region` key. */
export function regionFromCategory(category: MuscleCategory): Region {
  return CATEGORY_TO_REGION[category];
}

const MUSCLE_TO_CATEGORY: Map<string, MuscleCategory> = new Map(
  MUSCLE_GROUPS.map((m) => [m.id, m.category]),
);

export function regionFromMuscleId(muscleId: string): Region {
  const cat = MUSCLE_TO_CATEGORY.get(muscleId);
  return cat ? CATEGORY_TO_REGION[cat] : 'other';
}

/**
 * The exercise's dominant body region, used for tint/border color.
 *
 * Picks the first primaryMuscles entry's category. Primary muscles are
 * authored in priority order, so the head is what the lift is known for —
 * deadlift's primaries start with glutes/hamstrings, so it reads as "lower."
 *
 * Falls back to 'other' if the exercise has no primary muscles (custom
 * exercises *should* have at least one, enforced by the create schema, but
 * we don't want to throw if data is dirty).
 */
export function regionForExercise(exercise: { primaryMuscles: string[] }): Region {
  const first = exercise.primaryMuscles[0];
  return first ? regionFromMuscleId(first) : 'other';
}

// Tailwind class bundles keyed by region. Each value is a complete literal
// class string so the JIT scanner sees it at build time — never compose
// `${styles.border}/40` at runtime, Tailwind won't generate the rule.
export const REGION_STYLES: Record<
  Region,
  {
    // Solid border at full opacity. Use for chip "active" outlines and any
    // place a full-strength color is right.
    border: string;
    // Solid left border at full opacity — the bookmark-stripe pattern on
    // cards in the picker and in workout-view.
    leftBorder: string;
    // Thicker (2px) left border, used on exercise-in-session cards to give
    // the workout view a stronger region read.
    leftBorderThick: string;
    // Subtle border tint for chip "idle" state — visible but quiet.
    borderTint: string;
    // Hover state for the idle chip — stronger but still under active.
    borderTintHover: string;
    text: string;
    // Tinted background fill — section headers, soft callouts.
    bg: string;
    // Solid fill used for the chip "active" state and dot markers.
    dot: string;
    label: string;
  }
> = {
  upper: {
    border: 'border-region-upper',
    leftBorder: 'border-l-region-upper',
    leftBorderThick: 'border-l-2 border-l-region-upper',
    borderTint: 'border-region-upper/30',
    borderTintHover: 'hover:border-region-upper/70',
    text: 'text-region-upper',
    bg: 'bg-region-upper/10',
    dot: 'bg-region-upper',
    label: 'Upper',
  },
  lower: {
    border: 'border-region-lower',
    leftBorder: 'border-l-region-lower',
    leftBorderThick: 'border-l-2 border-l-region-lower',
    borderTint: 'border-region-lower/30',
    borderTintHover: 'hover:border-region-lower/70',
    text: 'text-region-lower',
    bg: 'bg-region-lower/10',
    dot: 'bg-region-lower',
    label: 'Lower',
  },
  core: {
    border: 'border-region-core',
    leftBorder: 'border-l-region-core',
    leftBorderThick: 'border-l-2 border-l-region-core',
    borderTint: 'border-region-core/30',
    borderTintHover: 'hover:border-region-core/70',
    text: 'text-region-core',
    bg: 'bg-region-core/10',
    dot: 'bg-region-core',
    label: 'Core',
  },
  mobility: {
    border: 'border-region-mobility',
    leftBorder: 'border-l-region-mobility',
    leftBorderThick: 'border-l-2 border-l-region-mobility',
    borderTint: 'border-region-mobility/30',
    borderTintHover: 'hover:border-region-mobility/70',
    text: 'text-region-mobility',
    bg: 'bg-region-mobility/10',
    dot: 'bg-region-mobility',
    label: 'Mobility',
  },
  other: {
    border: 'border-region-other',
    leftBorder: 'border-l-region-other',
    leftBorderThick: 'border-l-2 border-l-region-other',
    borderTint: 'border-region-other/30',
    borderTintHover: 'hover:border-region-other/70',
    text: 'text-region-other',
    bg: 'bg-region-other/10',
    dot: 'bg-region-other',
    label: 'Other',
  },
};

/** Tailwind classes for an exercise card's region accent (a left border). */
export function regionAccentForExercise(exercise: { primaryMuscles: string[] }): string {
  return REGION_STYLES[regionForExercise(exercise)].leftBorder;
}

/** Tailwind classes for the region chip used in the picker. */
export function regionStyle(region: Region) {
  return REGION_STYLES[region];
}
