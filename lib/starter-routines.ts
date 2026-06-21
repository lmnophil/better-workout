// Starter routines — the user-facing presets exposed in the /routine empty
// state. The user picks (focus × days × duration × equipment tier) and we
// build a draft routine with day templates resolved to specific exercises in
// the SEED_EXERCISES pool.
//
// Philosophical note (echoes root CLAUDE.md): a starter routine is a *seed*
// the user picks. Once they save (or even just edit the preview), it becomes
// their own user-authored routine. The app is not prescribing — it's showing
// a defensible starting structure that the user can keep, modify, or
// discard. We therefore avoid loaded language ("Day 1 — Heavy push day, you
// MUST hit 5×5"); descriptions stay neutral and templates are exercise lists,
// not coaching cues.
//
// Four focuses:
//   - 'strength'  — barbell-first, low-rep main lifts, longer rest.
//                   Defaults toward back squat / conventional deadlift /
//                   bench press. Skips niche kit (no trap bar, no specialty
//                   bars) so home-rack users land on mainstream lifts.
//   - 'build'     — joint-friendlier muscle-building. Dumbbell- and
//                   neutral-grip-first. Higher rep ranges (8-12). Goblet
//                   squat over back squat by default, DB bench over barbell.
//                   Designed for someone who still wants to lift heavy-ish
//                   but doesn't want to grind their joints.
//   - 'mobility'  — bodyweight / bands / mobility / SMR-heavy. Lower
//                   intensity. The "I want to feel better, not stronger"
//                   variant. Works well at 1-day-a-week cadences.
//   - 'longevity' — hybrid: one barbell main lift (trap-bar / RDL / front
//                   squat first), one posterior-chain accessory, one
//                   posture/scapular block, a balance finisher, and a
//                   short SMR section. The "I want to be moving well in
//                   ten years" variant. Descriptive only — not a coaching
//                   recommendation; the seed picks well-known patterns
//                   that the user is free to keep, swap, or discard.
//
// The duration knob (15 / 30 / 45 / 60 min) trims by priority — see the
// PRIORITY_CUTOFF table below. Lower duration drops accessories and SMR
// first; the main lifts are always kept.
//
// Equipment tier filters per slot. Each slot has a fallback chain (best
// variant first); the builder walks the chain until one fits the user's
// available kit. If no variant fits, the slot is dropped entirely. This
// can leave a routine thin in 'bands-only' or 'bodyweight-only' cases —
// the tradeoff is surfaced via the returned `tradeoffs` strings so the user
// can see what was cut.

import type { ExerciseModule } from './exercises-data';

// ============ TYPES ============

export const STARTER_FOCUSES = ['strength', 'build', 'mobility', 'longevity'] as const;
export type StarterFocus = (typeof STARTER_FOCUSES)[number];

export const STARTER_FOCUS_INFO: Record<StarterFocus, { label: string; description: string }> = {
  strength: {
    label: 'Strength',
    description: 'Barbell-first main lifts, low-rep ranges, longer rest.',
  },
  build: {
    label: 'Build',
    description:
      'Joint-friendlier muscle-building. Dumbbell variants and neutral grips by default.',
  },
  mobility: {
    label: 'Mobility',
    description: 'Bodyweight, bands, and mobility-forward — lower intensity.',
  },
  longevity: {
    label: 'Longevity',
    description:
      'Mixed barbell + posterior chain + posture + balance + SMR. A hybrid sketch you can edit.',
  },
};

export const STARTER_DURATIONS = [15, 30, 45, 60] as const;
export type StarterDuration = (typeof STARTER_DURATIONS)[number];

export const EQUIPMENT_TIERS = [
  'full-gym',
  'home-rack',
  'dumbbells-only',
  'bands-only',
  'bodyweight-only',
] as const;
export type EquipmentTier = (typeof EQUIPMENT_TIERS)[number];

// Display labels for each equipment token. Keep these short — they show as
// chip captions in the preset picker. Tokens that aren't in this map fall
// back to the raw string in the UI; they still work, just look like
// 'physio ball' instead of 'Physio ball'.
export const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: 'Barbell',
  rack: 'Rack',
  bench: 'Bench',
  dumbbells: 'Dumbbells',
  cable: 'Cable stack',
  machine: 'Machines',
  bands: 'Bands',
  'pull-up bar': 'Pull-up bar',
  rings: 'Rings',
  'dip bar': 'Dip bar',
  'foam roller': 'Foam roller',
  'lacrosse ball': 'Lacrosse ball',
  'physio ball': 'Physio ball',
  bosu: 'BOSU',
  'airex pad': 'Airex pad',
  'jump rope': 'Jump rope',
  mat: 'Mat',
};

// Grouping for the picker UI. Order within each group is the canonical order
// surfaced to users. Floor / SMR items group together so users can sweep them
// on/off as a unit. Specialty items go last — most users don't have them and
// scrolling past them as the final group keeps the common toggles up top.
export const EQUIPMENT_GROUPS: { label: string; tokens: readonly string[] }[] = [
  { label: 'Free weights', tokens: ['barbell', 'rack', 'bench', 'dumbbells'] },
  { label: 'Cables / machines', tokens: ['cable', 'machine'] },
  { label: 'Bands & bars', tokens: ['bands', 'pull-up bar', 'rings', 'dip bar'] },
  { label: 'Floor / SMR', tokens: ['mat', 'foam roller', 'lacrosse ball'] },
  { label: 'Specialty', tokens: ['physio ball', 'bosu', 'airex pad', 'jump rope'] },
];

export const EQUIPMENT_TIER_INFO: Record<EquipmentTier, { label: string; description: string }> = {
  'full-gym': {
    label: 'Full gym',
    description: 'Barbell, rack, bench, dumbbells, cables, machines, bands.',
  },
  'home-rack': {
    label: 'Home rack',
    description: 'Barbell + rack + bench + dumbbells + bands + pull-up bar.',
  },
  'dumbbells-only': {
    label: 'Dumbbells',
    description: 'A pair of dumbbells, a bench, optional bands and pull-up bar.',
  },
  'bands-only': {
    label: 'Bands only',
    description: 'Resistance bands and a mat. No free weights.',
  },
  'bodyweight-only': {
    label: 'Bodyweight',
    description: 'No equipment. A mat helps for floor work.',
  },
};

// Per-tier equipment whitelist. `'mat'` is in every tier — it's informational
// rather than gating, so an exercise needing a mat is always available; the
// preset surfaces a small "you'll need a mat" hint instead. Same for foam
// rollers / lacrosse balls in tiers that include them — having them is
// nice-to-have, missing them just degrades the SMR section gracefully.
//
// Exported so the picker UI can drive its "Quick set" preset buttons from the
// same source of truth as the builder. The picker also lets users hand-pick
// equipment beyond a tier (e.g. "home rack but I also have a cable stack");
// the builder takes the resulting Set directly via buildStarterRoutine.
export const TIER_EQUIPMENT: Record<EquipmentTier, ReadonlySet<string>> = {
  'full-gym': new Set([
    'barbell',
    'rack',
    'bench',
    'dumbbells',
    'cable',
    'machine',
    'bands',
    'pull-up bar',
    'rings',
    'dip bar',
    'foam roller',
    'lacrosse ball',
    'physio ball',
    'bosu',
    'airex pad',
    'jump rope',
    'mat',
  ]),
  'home-rack': new Set([
    'barbell',
    'rack',
    'bench',
    'dumbbells',
    'bands',
    'pull-up bar',
    'foam roller',
    'mat',
  ]),
  'dumbbells-only': new Set(['dumbbells', 'bench', 'bands', 'pull-up bar', 'foam roller', 'mat']),
  'bands-only': new Set(['bands', 'foam roller', 'mat']),
  'bodyweight-only': new Set(['foam roller', 'mat']),
};

export type SlotPriority = 1 | 2 | 3 | 4;

// 1 = essential, kept at every duration.
// 2 = core, kept at 30+ min.
// 3 = nice, kept at 45+ min.
// 4 = bonus (SMR, extra cardio), kept at 60 min only.
const PRIORITY_CUTOFF: Record<StarterDuration, SlotPriority> = {
  15: 1,
  30: 2,
  45: 3,
  60: 4,
};

type SlotChoice = {
  // Must match a SEED_EXERCISES.name. The builder returns names; the routine-
  // editor resolves names to ids when applying the preset.
  exerciseName: string;
  plannedSets: number;
  plannedReps?: number;
  // Used for time-metric exercises (planks, carries). Mutually exclusive with
  // plannedReps in normal use.
  plannedSeconds?: number;
  // Equipment tokens needed for this specific variant. Mirror what the
  // exercise itself declares in SEED_EXERCISES — duplicated here so the
  // builder can filter without a SEED_EXERCISES round-trip.
  equipment: readonly string[];
};

type Slot = {
  pattern: string;
  module: ExerciseModule;
  priority: SlotPriority;
  // Rough minutes-per-slot used for surfacing the "we trimmed X" tradeoff
  // message. Not used as a hard budget; PRIORITY_CUTOFF does the trimming.
  estMinutes: number;
  // Variants in preference order, best first. The builder picks the first
  // whose `equipment` is fully covered by the user's tier.
  variants: readonly SlotChoice[];
};

type DayBase = {
  // Used as the day's owned-template name. Neutral and structural — "Lower",
  // "Push", "Full body", not "Heavy day" / "Death day".
  name: string;
  slots: readonly Slot[];
};

type RoutineBase = {
  description: string;
  days: readonly DayBase[];
};

// ============ SLOT HELPERS ============
//
// Each helper returns one slot for a (focus, priority) pair. The variants
// cascade from highest-quality (full gym, free weights) down to bodyweight.
// Rep schemes shift with focus: strength = lower reps, build = mid, mobility
// = higher reps.

function smrSlot(): Slot {
  return {
    pattern: 'smr',
    module: 'SMR Lower',
    priority: 4,
    estMinutes: 3,
    variants: [
      {
        exerciseName: 'Foam roll quads',
        plannedSets: 1,
        plannedReps: 1,
        equipment: ['foam roller', 'mat'],
      },
      // Tier without a foam roller drops the SMR slot entirely; that's the
      // intent — there's no good substitute and it's recency-only anyway.
    ],
  };
}

function mobilitySlot(): Slot {
  return {
    pattern: 'mobility',
    module: 'Mobility Lower',
    priority: 3,
    estMinutes: 4,
    variants: [
      { exerciseName: '90/90 hip switches', plannedSets: 1, plannedReps: 8, equipment: ['mat'] },
      { exerciseName: 'Deep squat with reach', plannedSets: 1, plannedReps: 5, equipment: [] },
    ],
  };
}

function activationSlot(): Slot {
  return {
    pattern: 'activation',
    module: 'Activation Lower',
    priority: 2,
    estMinutes: 3,
    variants: [
      {
        exerciseName: 'Banded glute bridges with abduction',
        plannedSets: 2,
        plannedReps: 12,
        equipment: ['bands', 'mat'],
      },
      {
        exerciseName: 'Bodyweight glute bridge',
        plannedSets: 2,
        plannedReps: 12,
        equipment: ['mat'],
      },
    ],
  };
}

// Activation for upper-focused days. Glute bridges before bench/row is wasted
// prep — wake up the scapula and lower traps instead. Leads with anti-shrug
// because face pulls already show up in the longevity posture slot, and
// repeating the same exercise twice in one day is a poor signal even if the
// math works out. Bodyweight wall slides as the no-equipment fallback.
function activationUpperSlot(): Slot {
  return {
    pattern: 'activation-upper',
    module: 'Activation Upper',
    priority: 2,
    estMinutes: 3,
    variants: [
      {
        exerciseName: 'Banded anti-shrug',
        plannedSets: 2,
        plannedReps: 10,
        equipment: ['bands'],
      },
      {
        exerciseName: 'Scapular wall slides',
        plannedSets: 2,
        plannedReps: 8,
        equipment: [],
      },
    ],
  };
}

function squatSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength') {
    return {
      pattern: 'squat',
      module: 'Strength Barbell',
      priority,
      estMinutes: 7,
      variants: [
        {
          exerciseName: 'Back squat',
          plannedSets: 4,
          plannedReps: 5,
          equipment: ['barbell', 'rack'],
        },
        { exerciseName: 'Goblet squat', plannedSets: 4, plannedReps: 8, equipment: ['dumbbells'] },
        { exerciseName: 'Banded squat', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        { exerciseName: 'Bodyweight squat', plannedSets: 3, plannedReps: 15, equipment: [] },
      ],
    };
  }
  if (focus === 'build') {
    return {
      pattern: 'squat',
      module: 'Strength Accessory',
      priority,
      estMinutes: 6,
      variants: [
        { exerciseName: 'Goblet squat', plannedSets: 3, plannedReps: 10, equipment: ['dumbbells'] },
        {
          exerciseName: 'Back squat',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['barbell', 'rack'],
        },
        { exerciseName: 'Leg press', plannedSets: 3, plannedReps: 10, equipment: ['machine'] },
        { exerciseName: 'Banded squat', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        { exerciseName: 'Bodyweight squat', plannedSets: 3, plannedReps: 15, equipment: [] },
      ],
    };
  }
  // mobility
  return {
    pattern: 'squat',
    module: 'Strength Accessory',
    priority,
    estMinutes: 5,
    variants: [
      { exerciseName: 'Bodyweight squat', plannedSets: 3, plannedReps: 15, equipment: [] },
      { exerciseName: 'Banded squat', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Goblet squat', plannedSets: 3, plannedReps: 10, equipment: ['dumbbells'] },
    ],
  };
}

function hingeSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength') {
    return {
      pattern: 'hinge',
      module: 'Strength Barbell',
      priority,
      estMinutes: 7,
      variants: [
        {
          exerciseName: 'Conventional deadlift',
          plannedSets: 3,
          plannedReps: 5,
          equipment: ['barbell'],
        },
        {
          exerciseName: 'Romanian deadlift',
          plannedSets: 3,
          plannedReps: 6,
          equipment: ['barbell'],
        },
        { exerciseName: 'Dumbbell RDL', plannedSets: 3, plannedReps: 8, equipment: ['dumbbells'] },
        { exerciseName: 'Banded RDL', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        { exerciseName: 'Single-leg RDL', plannedSets: 3, plannedReps: 8, equipment: [] },
      ],
    };
  }
  if (focus === 'build') {
    return {
      pattern: 'hinge',
      module: 'Strength Accessory',
      priority,
      estMinutes: 6,
      variants: [
        {
          exerciseName: 'Romanian deadlift',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['barbell'],
        },
        { exerciseName: 'Dumbbell RDL', plannedSets: 3, plannedReps: 10, equipment: ['dumbbells'] },
        { exerciseName: 'Banded RDL', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        { exerciseName: 'Single-leg RDL', plannedSets: 3, plannedReps: 8, equipment: [] },
      ],
    };
  }
  return {
    pattern: 'hinge',
    module: 'Strength Accessory',
    priority,
    estMinutes: 5,
    variants: [
      { exerciseName: 'Single-leg RDL', plannedSets: 3, plannedReps: 8, equipment: [] },
      { exerciseName: 'Banded RDL', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      {
        exerciseName: 'Bodyweight glute bridge',
        plannedSets: 3,
        plannedReps: 15,
        equipment: ['mat'],
      },
    ],
  };
}

function pushSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength') {
    return {
      pattern: 'horizontal-push',
      module: 'Strength Barbell',
      priority,
      estMinutes: 7,
      variants: [
        {
          exerciseName: 'Bench press',
          plannedSets: 4,
          plannedReps: 5,
          equipment: ['barbell', 'bench', 'rack'],
        },
        {
          exerciseName: 'Dumbbell bench press',
          plannedSets: 4,
          plannedReps: 8,
          equipment: ['dumbbells', 'bench'],
        },
        {
          exerciseName: 'Banded chest press',
          plannedSets: 3,
          plannedReps: 12,
          equipment: ['bands'],
        },
        { exerciseName: 'Push-ups', plannedSets: 3, plannedReps: 12, equipment: [] },
      ],
    };
  }
  if (focus === 'build') {
    return {
      pattern: 'horizontal-push',
      module: 'Strength Accessory',
      priority,
      estMinutes: 6,
      variants: [
        {
          exerciseName: 'Dumbbell bench press',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['dumbbells', 'bench'],
        },
        {
          exerciseName: 'Bench press',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['barbell', 'bench', 'rack'],
        },
        {
          exerciseName: 'Incline dumbbell press',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['dumbbells', 'bench'],
        },
        {
          exerciseName: 'Banded chest press',
          plannedSets: 3,
          plannedReps: 12,
          equipment: ['bands'],
        },
        { exerciseName: 'Push-ups', plannedSets: 3, plannedReps: 12, equipment: [] },
      ],
    };
  }
  return {
    pattern: 'horizontal-push',
    module: 'Strength Accessory',
    priority,
    estMinutes: 5,
    variants: [
      { exerciseName: 'Push-ups', plannedSets: 3, plannedReps: 12, equipment: [] },
      { exerciseName: 'Knee push-ups', plannedSets: 3, plannedReps: 10, equipment: ['mat'] },
      { exerciseName: 'Banded chest press', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
    ],
  };
}

function pullSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength') {
    return {
      pattern: 'horizontal-pull',
      module: 'Strength Barbell',
      priority,
      estMinutes: 6,
      variants: [
        { exerciseName: 'Barbell row', plannedSets: 4, plannedReps: 6, equipment: ['barbell'] },
        {
          exerciseName: 'Single-arm dumbbell row',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['dumbbells', 'bench'],
        },
        { exerciseName: 'Cable row', plannedSets: 3, plannedReps: 10, equipment: ['cable'] },
        { exerciseName: 'Banded row', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        {
          exerciseName: 'Inverted row',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['rack', 'barbell'],
        },
      ],
    };
  }
  if (focus === 'build') {
    return {
      pattern: 'horizontal-pull',
      module: 'Strength Accessory',
      priority,
      estMinutes: 5,
      variants: [
        {
          exerciseName: 'Single-arm dumbbell row',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['dumbbells', 'bench'],
        },
        {
          exerciseName: 'Chest-supported dumbbell row',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['dumbbells', 'bench'],
        },
        { exerciseName: 'Cable row', plannedSets: 3, plannedReps: 10, equipment: ['cable'] },
        { exerciseName: 'Banded row', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        {
          exerciseName: 'Inverted row',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['rack', 'barbell'],
        },
      ],
    };
  }
  return {
    pattern: 'horizontal-pull',
    module: 'Strength Accessory',
    priority,
    estMinutes: 5,
    variants: [
      { exerciseName: 'Banded row', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      {
        exerciseName: 'Inverted row',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['rack', 'barbell'],
      },
      {
        exerciseName: 'Single-arm dumbbell row',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['dumbbells', 'bench'],
      },
    ],
  };
}

function vPushSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength') {
    return {
      pattern: 'vertical-push',
      module: 'Strength Barbell',
      priority,
      estMinutes: 6,
      variants: [
        {
          exerciseName: 'Overhead press',
          plannedSets: 3,
          plannedReps: 5,
          equipment: ['barbell', 'rack'],
        },
        {
          exerciseName: 'Dumbbell shoulder press',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['dumbbells'],
        },
        {
          exerciseName: 'Banded shoulder press',
          plannedSets: 3,
          plannedReps: 12,
          equipment: ['bands'],
        },
        { exerciseName: 'Pike push-ups', plannedSets: 3, plannedReps: 8, equipment: [] },
      ],
    };
  }
  if (focus === 'build') {
    return {
      pattern: 'vertical-push',
      module: 'Strength Accessory',
      priority,
      estMinutes: 5,
      variants: [
        {
          exerciseName: 'Seated dumbbell shoulder press',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['dumbbells', 'bench'],
        },
        {
          exerciseName: 'Dumbbell shoulder press',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['dumbbells'],
        },
        {
          exerciseName: 'Banded shoulder press',
          plannedSets: 3,
          plannedReps: 12,
          equipment: ['bands'],
        },
        { exerciseName: 'Pike push-ups', plannedSets: 3, plannedReps: 8, equipment: [] },
      ],
    };
  }
  return {
    pattern: 'vertical-push',
    module: 'Strength Accessory',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Pike push-ups', plannedSets: 3, plannedReps: 8, equipment: [] },
      {
        exerciseName: 'Banded shoulder press',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands'],
      },
    ],
  };
}

function vPullSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength') {
    return {
      pattern: 'vertical-pull',
      module: 'Strength Accessory',
      priority,
      estMinutes: 6,
      variants: [
        { exerciseName: 'Pull-ups', plannedSets: 4, plannedReps: 6, equipment: ['pull-up bar'] },
        { exerciseName: 'Lat pulldown', plannedSets: 3, plannedReps: 8, equipment: ['cable'] },
        { exerciseName: 'Banded pulldown', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
        {
          exerciseName: 'Inverted row',
          plannedSets: 3,
          plannedReps: 10,
          equipment: ['rack', 'barbell'],
        },
      ],
    };
  }
  if (focus === 'build') {
    return {
      pattern: 'vertical-pull',
      module: 'Strength Accessory',
      priority,
      estMinutes: 5,
      variants: [
        { exerciseName: 'Lat pulldown', plannedSets: 3, plannedReps: 10, equipment: ['cable'] },
        { exerciseName: 'Pull-ups', plannedSets: 3, plannedReps: 8, equipment: ['pull-up bar'] },
        { exerciseName: 'Chin-ups', plannedSets: 3, plannedReps: 8, equipment: ['pull-up bar'] },
        { exerciseName: 'Banded pulldown', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      ],
    };
  }
  return {
    pattern: 'vertical-pull',
    module: 'Strength Accessory',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Banded pulldown', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Pull-ups', plannedSets: 3, plannedReps: 5, equipment: ['pull-up bar'] },
    ],
  };
}

function lungeSlot(focus: StarterFocus, priority: SlotPriority): Slot {
  if (focus === 'strength' || focus === 'build') {
    return {
      pattern: 'lunge',
      module: 'Strength Accessory',
      priority,
      estMinutes: 5,
      variants: [
        {
          exerciseName: 'Dumbbell walking lunges',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['dumbbells'],
        },
        {
          exerciseName: 'Bulgarian squat (seated step away)',
          plannedSets: 3,
          plannedReps: 8,
          equipment: ['dumbbells', 'bench'],
        },
        { exerciseName: 'Walking lunges', plannedSets: 3, plannedReps: 10, equipment: [] },
        { exerciseName: 'Reverse lunges', plannedSets: 3, plannedReps: 10, equipment: [] },
      ],
    };
  }
  return {
    pattern: 'lunge',
    module: 'Strength Accessory',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Reverse lunges', plannedSets: 3, plannedReps: 10, equipment: [] },
      { exerciseName: 'Walking lunges', plannedSets: 3, plannedReps: 10, equipment: [] },
    ],
  };
}

function hipThrustSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'hip-thrust',
    module: 'Strength Accessory',
    priority,
    estMinutes: 5,
    variants: [
      {
        exerciseName: 'Dumbbell hip thrust',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['dumbbells', 'bench', 'mat'],
      },
      {
        exerciseName: 'Banded hip thrust',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands', 'bench', 'mat'],
      },
      {
        exerciseName: 'Bodyweight hip thrust',
        plannedSets: 3,
        plannedReps: 15,
        equipment: ['bench', 'mat'],
      },
    ],
  };
}

function bicepsSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'biceps',
    module: 'Strength Accessory',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Bicep curl', plannedSets: 3, plannedReps: 10, equipment: ['dumbbells'] },
      { exerciseName: 'Hammer curl', plannedSets: 3, plannedReps: 10, equipment: ['dumbbells'] },
      { exerciseName: 'Banded curl', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Chin-ups', plannedSets: 3, plannedReps: 5, equipment: ['pull-up bar'] },
    ],
  };
}

function tricepsSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'triceps',
    module: 'Strength Accessory',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Tricep pushdown', plannedSets: 3, plannedReps: 12, equipment: ['cable'] },
      {
        exerciseName: 'Overhead tricep extension',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['dumbbells'],
      },
      {
        exerciseName: 'Banded tricep extension',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands'],
      },
      { exerciseName: 'Diamond push-ups', plannedSets: 3, plannedReps: 10, equipment: [] },
      { exerciseName: 'Bench dips', plannedSets: 3, plannedReps: 12, equipment: ['bench'] },
    ],
  };
}

function shouldersSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'shoulders-isolation',
    module: 'Strength Accessory',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Lateral raises', plannedSets: 3, plannedReps: 12, equipment: ['dumbbells'] },
      {
        exerciseName: 'Banded lateral raise',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands'],
      },
    ],
  };
}

// Postural / scapular work for upper days. The variant chain prefers band
// work (pull-aparts and face pulls hit rear delts + scapular + lower traps
// together) and falls back to dumbbell reverse fly or bodyweight prone Y
// raises when bands aren't available. Without this, the upper-body presets
// systematically miss rear delts, scapular stabilizers, and lower traps —
// the postural muscles that don't show up as primary work on the main lifts.
// Priority 3: kept at 45+ min, trimmed at 15-30.
function thoracicSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'thoracic',
    module: 'Strength Thoracic',
    priority,
    estMinutes: 3,
    variants: [
      { exerciseName: 'Banded pull-aparts', plannedSets: 3, plannedReps: 15, equipment: ['bands'] },
      { exerciseName: 'Banded face pulls', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Reverse fly', plannedSets: 3, plannedReps: 12, equipment: ['dumbbells'] },
      { exerciseName: 'Prone Y raises', plannedSets: 2, plannedReps: 8, equipment: ['mat'] },
    ],
  };
}

function coreSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'core',
    module: 'Activation Trunk',
    priority,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Plank', plannedSets: 3, plannedSeconds: 45, equipment: ['mat'] },
      { exerciseName: 'Hollow hold', plannedSets: 3, plannedSeconds: 30, equipment: ['mat'] },
      { exerciseName: 'Side plank', plannedSets: 2, plannedSeconds: 30, equipment: ['mat'] },
      { exerciseName: 'Bear hold', plannedSets: 3, plannedSeconds: 25, equipment: ['mat'] },
    ],
  };
}

function carrySlot(priority: SlotPriority): Slot {
  return {
    pattern: 'carry',
    module: 'Rev Up',
    priority,
    estMinutes: 4,
    variants: [
      {
        exerciseName: 'Farmer carry',
        plannedSets: 3,
        plannedSeconds: 40,
        equipment: ['dumbbells'],
      },
      {
        exerciseName: 'Suitcase carry',
        plannedSets: 2,
        plannedSeconds: 40,
        equipment: ['dumbbells'],
      },
    ],
  };
}

function conditioningSlot(priority: SlotPriority): Slot {
  return {
    pattern: 'conditioning',
    module: 'Rev Up',
    priority,
    estMinutes: 3,
    variants: [
      { exerciseName: 'Jump rope', plannedSets: 3, plannedSeconds: 60, equipment: ['jump rope'] },
      { exerciseName: 'Jumping jacks', plannedSets: 3, plannedSeconds: 45, equipment: [] },
      { exerciseName: 'Mountain climbers', plannedSets: 3, plannedSeconds: 30, equipment: ['mat'] },
      { exerciseName: 'High knees', plannedSets: 3, plannedSeconds: 30, equipment: [] },
    ],
  };
}

// Mobility-focus heavy section: SMR + a stretch + an activation, all P1/P2
// so they survive even at low durations. The whole point of this focus is
// the "make me feel better" content; trimming it out leaves nothing.
function mobilityCoreBlock(): readonly Slot[] {
  return [
    {
      pattern: 'mobility-prep',
      module: 'Mobility Lower',
      priority: 1,
      estMinutes: 4,
      variants: [
        { exerciseName: '90/90 hip switches', plannedSets: 1, plannedReps: 8, equipment: ['mat'] },
        { exerciseName: 'Deep squat with reach', plannedSets: 1, plannedReps: 5, equipment: [] },
      ],
    },
    {
      pattern: 'mobility-upper',
      module: 'Mobility Upper',
      priority: 2,
      estMinutes: 3,
      variants: [
        { exerciseName: 'Thread the needle', plannedSets: 1, plannedReps: 8, equipment: ['mat'] },
        { exerciseName: 'Doorway pec stretch', plannedSets: 1, plannedReps: 1, equipment: [] },
      ],
    },
    {
      pattern: 'mobility-trunk',
      module: 'Mobility Trunk',
      priority: 3,
      estMinutes: 3,
      variants: [
        { exerciseName: "World's greatest stretch", plannedSets: 1, plannedReps: 5, equipment: [] },
        { exerciseName: 'Cat-cow', plannedSets: 1, plannedReps: 10, equipment: ['mat'] },
      ],
    },
    {
      pattern: 'smr-lower',
      module: 'SMR Lower',
      priority: 4,
      estMinutes: 3,
      variants: [
        {
          exerciseName: 'Foam roll quads',
          plannedSets: 1,
          plannedReps: 1,
          equipment: ['foam roller', 'mat'],
        },
      ],
    },
  ];
}

// ============ ROUTINES ============

// Helper to build a "full body" day with the seven movement patterns.
function fullBodyDay(focus: StarterFocus, name: string): DayBase {
  return {
    name,
    slots: [
      activationSlot(),
      squatSlot(focus, 1),
      hingeSlot(focus, 1),
      pushSlot(focus, 1),
      pullSlot(focus, 1),
      vPushSlot(focus, 2),
      vPullSlot(focus, 2),
      coreSlot(2),
      thoracicSlot(3),
      lungeSlot(focus, 3),
      carrySlot(3),
      conditioningSlot(4),
    ],
  };
}

function lowerDay(focus: StarterFocus, name: string, hingeFirst = false): DayBase {
  const main = hingeFirst
    ? [hingeSlot(focus, 1), squatSlot(focus, 1)]
    : [squatSlot(focus, 1), hingeSlot(focus, 1)];
  return {
    name,
    slots: [
      activationSlot(),
      ...main,
      lungeSlot(focus, 2),
      hipThrustSlot(2),
      coreSlot(2),
      carrySlot(3),
      mobilitySlot(),
      smrSlot(),
    ],
  };
}

function upperDay(focus: StarterFocus, name: string): DayBase {
  return {
    name,
    slots: [
      pushSlot(focus, 1),
      pullSlot(focus, 1),
      vPushSlot(focus, 2),
      vPullSlot(focus, 2),
      thoracicSlot(3),
      bicepsSlot(3),
      tricepsSlot(3),
      shouldersSlot(3),
      coreSlot(2),
      mobilitySlot(),
      smrSlot(),
    ],
  };
}

function pushDay(focus: StarterFocus, name: string): DayBase {
  return {
    name,
    slots: [
      pushSlot(focus, 1),
      vPushSlot(focus, 1),
      shouldersSlot(2),
      tricepsSlot(2),
      thoracicSlot(3),
      coreSlot(3),
      conditioningSlot(4),
    ],
  };
}

function pullDay(focus: StarterFocus, name: string): DayBase {
  return {
    name,
    slots: [
      pullSlot(focus, 1),
      vPullSlot(focus, 1),
      bicepsSlot(2),
      thoracicSlot(3),
      coreSlot(2),
      carrySlot(3),
      mobilitySlot(),
    ],
  };
}

function legsDay(focus: StarterFocus, name: string): DayBase {
  return {
    name,
    slots: [
      activationSlot(),
      squatSlot(focus, 1),
      hingeSlot(focus, 1),
      lungeSlot(focus, 2),
      hipThrustSlot(2),
      coreSlot(3),
      carrySlot(3),
      smrSlot(),
    ],
  };
}

// Mobility-focus day: a full session of SMR + mobility + light bodyweight.
function mobilityDay(name: string, includeStrength = true): DayBase {
  return {
    name,
    slots: [
      ...mobilityCoreBlock(),
      ...(includeStrength
        ? [squatSlot('mobility', 2), pushSlot('mobility', 2), pullSlot('mobility', 2), coreSlot(2)]
        : [coreSlot(2)]),
      conditioningSlot(3),
    ],
  };
}

// ============ LONGEVITY-FOCUS SLOTS ============
//
// Longevity days are assembled around five pieces: one barbell main lift
// (squat or hinge), one posterior-chain accessory, one posture/scapular
// block, a balance finisher, and a short SMR section. The slot helpers
// below define each piece. Variants cascade from full-gym → home-rack →
// dumbbells-only → bands → bodyweight, same pattern as the other focuses.

function longevityHingeMainSlot(): Slot {
  return {
    pattern: 'longevity-hinge',
    module: 'Strength Barbell',
    priority: 1,
    estMinutes: 7,
    variants: [
      // Trap bar is the lead per the longevity archetype — spine-friendly hip
      // hinge — but the next-best plates fall through cleanly for users
      // without one.
      { exerciseName: 'Trap bar deadlift', plannedSets: 4, plannedReps: 6, equipment: ['barbell'] },
      { exerciseName: 'Romanian deadlift', plannedSets: 4, plannedReps: 8, equipment: ['barbell'] },
      { exerciseName: 'Dumbbell RDL', plannedSets: 4, plannedReps: 8, equipment: ['dumbbells'] },
      { exerciseName: 'Banded RDL', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Single-leg RDL', plannedSets: 3, plannedReps: 8, equipment: [] },
    ],
  };
}

function longevitySquatMainSlot(): Slot {
  return {
    pattern: 'longevity-squat',
    module: 'Strength Barbell',
    priority: 1,
    estMinutes: 7,
    variants: [
      // Front squat first — upright torso, less spinal-shear than back squat,
      // matches the longevity archetype's bias toward joint-friendlier lifts.
      {
        exerciseName: 'Front squat',
        plannedSets: 4,
        plannedReps: 5,
        equipment: ['barbell', 'rack'],
      },
      {
        exerciseName: 'Back squat',
        plannedSets: 4,
        plannedReps: 6,
        equipment: ['barbell', 'rack'],
      },
      { exerciseName: 'Goblet squat', plannedSets: 3, plannedReps: 10, equipment: ['dumbbells'] },
      { exerciseName: 'Banded squat', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Bodyweight squat', plannedSets: 3, plannedReps: 15, equipment: [] },
    ],
  };
}

function posteriorChainSlot(): Slot {
  return {
    pattern: 'posterior-chain',
    module: 'Strength Accessory',
    priority: 1,
    estMinutes: 6,
    variants: [
      {
        exerciseName: 'Physio ball hamstring bridges',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['physio ball', 'mat'],
      },
      {
        exerciseName: 'Posterior chain leg lifts (ball)',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['physio ball', 'bands'],
      },
      {
        exerciseName: 'Banded hip thrust',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands', 'bench', 'mat'],
      },
      {
        exerciseName: 'Dumbbell hip thrust',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['dumbbells', 'bench', 'mat'],
      },
      {
        exerciseName: 'Bodyweight hip thrust',
        plannedSets: 3,
        plannedReps: 15,
        equipment: ['bench', 'mat'],
      },
      {
        exerciseName: 'Bodyweight glute bridge',
        plannedSets: 3,
        plannedReps: 15,
        equipment: ['mat'],
      },
    ],
  };
}

// Postural / scapular block on every longevity day. Leads with face pulls
// (rear delts primary, scapular/back/lower-traps secondary) rather than a
// scapular-primary movement: when this slot fires on three or more days a
// week, leading with a scapular-primary exercise pushes scapular volume well
// past 1.5× target and starves the rear delts in comparison. Face pulls
// distribute the same posture work across the whole shoulder-girdle complex.
function postureSlot(): Slot {
  return {
    pattern: 'posture-scapular',
    module: 'Strength Thoracic',
    priority: 2,
    estMinutes: 4,
    variants: [
      { exerciseName: 'Banded face pulls', plannedSets: 3, plannedReps: 12, equipment: ['bands'] },
      { exerciseName: 'Banded pull-aparts', plannedSets: 3, plannedReps: 15, equipment: ['bands'] },
      { exerciseName: 'Reverse fly', plannedSets: 3, plannedReps: 12, equipment: ['dumbbells'] },
      {
        exerciseName: 'Scapular postural band work',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands'],
      },
      { exerciseName: 'Prone Y raises', plannedSets: 2, plannedReps: 10, equipment: ['mat'] },
    ],
  };
}

function balanceFinisherSlot(): Slot {
  return {
    pattern: 'balance-finisher',
    module: 'Balance',
    priority: 3,
    estMinutes: 5,
    variants: [
      {
        exerciseName: 'BOSU dome single-leg holds',
        plannedSets: 3,
        plannedSeconds: 60,
        equipment: ['bosu'],
      },
      {
        exerciseName: 'Airex pad single-leg holds',
        plannedSets: 3,
        plannedSeconds: 60,
        equipment: ['airex pad'],
      },
      {
        exerciseName: 'BOSU flat single-leg holds',
        plannedSets: 3,
        plannedSeconds: 60,
        equipment: ['bosu'],
      },
      {
        exerciseName: 'Single-leg balance hold',
        plannedSets: 3,
        plannedSeconds: 30,
        equipment: [],
      },
    ],
  };
}

// Longevity-flavored lower day. Five-piece arc (activation → main → posterior
// chain → posture → balance) plus a horizontal row at P3 — the row is what
// keeps back coverage above the floor on routines where lower days outnumber
// upper days. Trimmed first at 30-min sessions so the main lift and posture
// block stay protected.
function longevityLowerDay(name: string, hingeLed: boolean): DayBase {
  const main = hingeLed ? longevityHingeMainSlot() : longevitySquatMainSlot();
  return {
    name,
    slots: [
      activationSlot(),
      main,
      posteriorChainSlot(),
      postureSlot(),
      pullSlot('build', 3),
      balanceFinisherSlot(),
      mobilitySlot(),
      smrSlot(),
    ],
  };
}

// Second horizontal push for longevity upper days. The lone primary push
// (DB bench, 3 sets) puts chest under its weekly minimum on the 3-day cycle
// where upper only fires once. This finisher adds a complementary angle
// (incline / push-ups / banded press) at P3 so 45+ min sessions land at
// chest min, while shorter sessions still trim it out. Equipment cascade
// covers every tier including bodyweight.
function longevityChestAccessorySlot(): Slot {
  return {
    pattern: 'horizontal-push-finisher',
    module: 'Strength Accessory',
    priority: 3,
    estMinutes: 4,
    variants: [
      {
        exerciseName: 'Incline dumbbell press',
        plannedSets: 3,
        plannedReps: 10,
        equipment: ['dumbbells', 'bench'],
      },
      {
        exerciseName: 'Banded chest press',
        plannedSets: 3,
        plannedReps: 12,
        equipment: ['bands'],
      },
      { exerciseName: 'Push-ups', plannedSets: 3, plannedReps: 12, equipment: [] },
    ],
  };
}

// Longevity upper day. The original sketch was just push + pull + posture, which
// systematically left vertical work, biceps, triceps, and shoulders untouched —
// fine on a 6-day routine where upper fires twice, but a 3-day longevity routine
// has only one upper day and was missing half the upper body. The full pattern
// here mirrors the strength/build upper day with the longevity-specific posture
// + balance closer kept on top, plus a chest finisher to keep horizontal
// pushing above its weekly floor. Accessories sit at P3 so 30-min sessions
// still trim down to the essentials.
function longevityUpperDay(name: string): DayBase {
  return {
    name,
    slots: [
      activationUpperSlot(),
      pushSlot('build', 1),
      pullSlot('build', 1),
      vPushSlot('build', 2),
      vPullSlot('build', 2),
      postureSlot(),
      longevityChestAccessorySlot(),
      bicepsSlot(3),
      tricepsSlot(3),
      shouldersSlot(3),
      coreSlot(2),
      balanceFinisherSlot(),
      mobilitySlot(),
      smrSlot(),
    ],
  };
}

// True full-body longevity day for the 1-day preset. The old 1-day was just a
// hinge-led lower day — no chest, no pulling, no shoulders — which left every
// upper-body muscle at zero. This version trades posterior-chain isolation for
// horizontal push/pull so a once-a-week longevity user touches everything.
function longevityFullBodyDay(name: string, hingeLed: boolean): DayBase {
  const main = hingeLed ? longevityHingeMainSlot() : longevitySquatMainSlot();
  return {
    name,
    slots: [
      activationSlot(),
      main,
      pushSlot('build', 1),
      pullSlot('build', 1),
      postureSlot(),
      coreSlot(2),
      balanceFinisherSlot(),
      mobilitySlot(),
      smrSlot(),
    ],
  };
}

// Each focus has 7 day-counts. Built from helpers above.
const STARTER_ROUTINES: Record<StarterFocus, Record<number, RoutineBase>> = {
  strength: {
    1: {
      description: 'One full-body strength session per cycle.',
      days: [fullBodyDay('strength', 'Full body')],
    },
    2: {
      description: 'Upper / lower split.',
      days: [lowerDay('strength', 'Lower'), upperDay('strength', 'Upper')],
    },
    3: {
      description: 'Push / pull / legs.',
      days: [pushDay('strength', 'Push'), pullDay('strength', 'Pull'), legsDay('strength', 'Legs')],
    },
    4: {
      description: 'Upper / lower, twice over with squat- and deadlift-led legs days.',
      days: [
        lowerDay('strength', 'Lower (squat)'),
        upperDay('strength', 'Upper (bench)'),
        lowerDay('strength', 'Lower (deadlift)', true),
        upperDay('strength', 'Upper (row)'),
      ],
    },
    5: {
      description: 'Push / pull / legs + upper / lower.',
      days: [
        pushDay('strength', 'Push'),
        pullDay('strength', 'Pull'),
        legsDay('strength', 'Legs'),
        upperDay('strength', 'Upper'),
        lowerDay('strength', 'Lower'),
      ],
    },
    6: {
      description: 'Push / pull / legs, twice.',
      days: [
        pushDay('strength', 'Push A'),
        pullDay('strength', 'Pull A'),
        legsDay('strength', 'Legs A'),
        pushDay('strength', 'Push B'),
        pullDay('strength', 'Pull B'),
        legsDay('strength', 'Legs B'),
      ],
    },
    7: {
      description: 'Push / pull / legs twice over, plus a mobility day.',
      days: [
        pushDay('strength', 'Push A'),
        pullDay('strength', 'Pull A'),
        legsDay('strength', 'Legs A'),
        pushDay('strength', 'Push B'),
        pullDay('strength', 'Pull B'),
        legsDay('strength', 'Legs B'),
        mobilityDay('Mobility', false),
      ],
    },
  },
  build: {
    1: {
      description: 'One full-body hypertrophy session per cycle.',
      days: [fullBodyDay('build', 'Full body')],
    },
    2: {
      description: 'Upper / lower split, joint-friendly defaults.',
      days: [lowerDay('build', 'Lower'), upperDay('build', 'Upper')],
    },
    3: {
      description: 'Push / pull / legs, dumbbell-first.',
      days: [pushDay('build', 'Push'), pullDay('build', 'Pull'), legsDay('build', 'Legs')],
    },
    4: {
      description: 'Upper / lower split, twice. More accessory volume than strength focus.',
      days: [
        upperDay('build', 'Upper A'),
        lowerDay('build', 'Lower A'),
        upperDay('build', 'Upper B'),
        lowerDay('build', 'Lower B'),
      ],
    },
    5: {
      description: 'Push / pull / legs + upper / lower, dumbbell-led.',
      days: [
        pushDay('build', 'Push'),
        pullDay('build', 'Pull'),
        legsDay('build', 'Legs'),
        upperDay('build', 'Upper'),
        lowerDay('build', 'Lower'),
      ],
    },
    6: {
      description: 'Push / pull / legs, twice over.',
      days: [
        pushDay('build', 'Push A'),
        pullDay('build', 'Pull A'),
        legsDay('build', 'Legs A'),
        pushDay('build', 'Push B'),
        pullDay('build', 'Pull B'),
        legsDay('build', 'Legs B'),
      ],
    },
    7: {
      description: 'Push / pull / legs twice over plus a mobility day.',
      days: [
        pushDay('build', 'Push A'),
        pullDay('build', 'Pull A'),
        legsDay('build', 'Legs A'),
        pushDay('build', 'Push B'),
        pullDay('build', 'Pull B'),
        legsDay('build', 'Legs B'),
        mobilityDay('Mobility', false),
      ],
    },
  },
  mobility: {
    1: {
      description: 'A single full-body mobility + light strength session.',
      days: [mobilityDay('Full body')],
    },
    2: {
      description: 'Two mobility-led sessions a cycle.',
      days: [mobilityDay('Day A'), mobilityDay('Day B')],
    },
    3: {
      description: 'Three mobility / light-strength sessions per cycle.',
      days: [mobilityDay('Day 1'), mobilityDay('Day 2'), mobilityDay('Day 3')],
    },
    4: {
      description: 'Four mobility / light-strength sessions.',
      days: [
        mobilityDay('Day 1'),
        mobilityDay('Day 2'),
        mobilityDay('Day 3'),
        mobilityDay('Day 4'),
      ],
    },
    5: {
      description: 'Five mobility-led sessions per cycle.',
      days: [
        mobilityDay('Day 1'),
        mobilityDay('Day 2'),
        mobilityDay('Day 3'),
        mobilityDay('Day 4'),
        mobilityDay('Day 5'),
      ],
    },
    6: {
      description: 'Six mobility-led sessions; one can be a stretch-only day.',
      days: [
        mobilityDay('Day 1'),
        mobilityDay('Day 2'),
        mobilityDay('Day 3'),
        mobilityDay('Day 4'),
        mobilityDay('Day 5'),
        mobilityDay('Day 6 (stretch)', false),
      ],
    },
    7: {
      description: 'Daily mobility — strength on most days, stretch-only on day 7.',
      days: [
        mobilityDay('Day 1'),
        mobilityDay('Day 2'),
        mobilityDay('Day 3'),
        mobilityDay('Day 4'),
        mobilityDay('Day 5'),
        mobilityDay('Day 6'),
        mobilityDay('Day 7 (stretch)', false),
      ],
    },
  },
  longevity: {
    1: {
      description:
        'One full-body longevity session: hinge main lift, push, pull, posture, balance, mobility.',
      days: [longevityFullBodyDay('Full body', true)],
    },
    2: {
      description: 'Hinge-led lower day + a full upper day.',
      days: [longevityLowerDay('Lower (hinge)', true), longevityUpperDay('Upper')],
    },
    3: {
      description: 'Hinge day + upper day + squat day.',
      days: [
        longevityLowerDay('Lower (hinge)', true),
        longevityUpperDay('Upper'),
        longevityLowerDay('Lower (squat)', false),
      ],
    },
    4: {
      description: 'Lower / upper / lower / upper — even split.',
      days: [
        longevityLowerDay('Lower (hinge)', true),
        longevityUpperDay('Upper A'),
        longevityLowerDay('Lower (squat)', false),
        longevityUpperDay('Upper B'),
      ],
    },
    5: {
      description: 'Hinge / upper / squat / upper / hinge B — three lower, two upper.',
      days: [
        longevityLowerDay('Day 1 (hinge)', true),
        longevityUpperDay('Day 2 (upper A)'),
        longevityLowerDay('Day 3 (squat)', false),
        longevityUpperDay('Day 4 (upper B)'),
        longevityLowerDay('Day 5 (hinge B)', true),
      ],
    },
    6: {
      description: 'Lower / upper alternating across the cycle.',
      days: [
        longevityLowerDay('Day 1 (hinge)', true),
        longevityUpperDay('Day 2 (upper A)'),
        longevityLowerDay('Day 3 (squat)', false),
        longevityUpperDay('Day 4 (upper B)'),
        longevityLowerDay('Day 5 (hinge B)', true),
        longevityUpperDay('Day 6 (upper C)'),
      ],
    },
    7: {
      description: 'Lower / upper alternating with a mobility-only closer.',
      days: [
        longevityLowerDay('Day 1 (hinge)', true),
        longevityUpperDay('Day 2 (upper A)'),
        longevityLowerDay('Day 3 (squat)', false),
        longevityUpperDay('Day 4 (upper B)'),
        longevityLowerDay('Day 5 (hinge B)', true),
        longevityUpperDay('Day 6 (upper C)'),
        mobilityDay('Day 7 (mobility)', false),
      ],
    },
  },
};

// ============ BUILDER ============

export type BuiltExercise = {
  exerciseName: string;
  plannedSets: number;
  plannedReps: number | null;
  plannedSeconds: number | null;
};

export type BuiltDay = {
  name: string;
  exercises: BuiltExercise[];
  // Why this day ended up with no exercises, when it did. 'equipment' = no
  // variant in any slot fit the selected gear (or every fit collided with an
  // exercise already used that day); 'duration' = everything was trimmed by the
  // time budget. null when the day has exercises. Lets the preview show an
  // accurate per-day notice and lets the apply path keep the day instead of
  // silently shrinking the routine.
  emptyReason: 'equipment' | 'duration' | null;
};

export type BuildStarterRoutineResult = {
  description: string;
  days: BuiltDay[];
  // Plain-English notes about what was trimmed from the base routine due to
  // duration or equipment constraints. Surfaced under the preview so the user
  // sees the tradeoffs.
  tradeoffs: string[];
  // True if any included exercise needs a mat. Surfaced as a small note.
  needsMat: boolean;
};

// Resolve a slot to a concrete variant. Walks the slot's preference chain and
// returns the first variant that (a) isn't already used elsewhere in this day
// and (b) has all its *gating* equipment available. `'mat'` is deliberately not
// gating — it's informational (see the TIER_EQUIPMENT note), so a mat-dependent
// variant stays selectable even when the user unticks mat; the missing-mat
// consequence surfaces as the `needsMat` hint instead of a silently dropped
// exercise. The dedupe guard is what keeps two slots in the same day from both
// cascading to the same fallback (e.g. Bodyweight glute bridge), which used to
// produce a duplicate the save path rejects outright.
function pickVariant(
  slot: Slot,
  available: ReadonlySet<string>,
  used: ReadonlySet<string>,
): SlotChoice | null {
  for (const v of slot.variants) {
    if (used.has(v.exerciseName)) continue;
    if (v.equipment.every((e) => e === 'mat' || available.has(e))) return v;
  }
  return null;
}

export function buildStarterRoutine(input: {
  focus: StarterFocus;
  days: number;
  durationMinutes: StarterDuration;
  // The equipment the user has available. Either pass `TIER_EQUIPMENT[tier]`
  // for one of the canonical tiers, or pass a hand-picked Set when the user
  // has refined per-token availability. The builder doesn't care — every
  // variant's `equipment` requirements are checked against this Set.
  availableEquipment: ReadonlySet<string>;
}): BuildStarterRoutineResult {
  const { focus, days, durationMinutes, availableEquipment } = input;
  const base = STARTER_ROUTINES[focus]?.[days];
  if (!base) {
    return {
      description: '',
      days: [],
      tradeoffs: [`No starter routine for ${focus} × ${days} days.`],
      needsMat: false,
    };
  }
  const available = availableEquipment;
  const cutoff = PRIORITY_CUTOFF[durationMinutes];

  const builtDays: BuiltDay[] = [];
  const tradeoffs = new Set<string>();
  let needsMat = false;
  let trimmedAny = false;
  let droppedAny = false;

  for (const day of base.days) {
    const exercises: BuiltExercise[] = [];
    const used = new Set<string>();
    let droppedInDay = false;
    for (const slot of day.slots) {
      // Check the duration cutoff *before* equipment so a slot the time budget
      // would have trimmed anyway doesn't also count as an equipment drop — that
      // ordering used to inflate the "we dropped slots" tradeoff message.
      if (slot.priority > cutoff) {
        trimmedAny = true;
        continue;
      }
      const variant = pickVariant(slot, available, used);
      if (!variant) {
        droppedAny = true;
        droppedInDay = true;
        continue;
      }
      used.add(variant.exerciseName);
      // Only flag "you'll want a mat" when a chosen exercise needs one and the
      // user hasn't got mat selected — mat is non-gating, so the hint is the
      // visible consequence of leaving it off.
      if (variant.equipment.includes('mat') && !available.has('mat')) needsMat = true;
      exercises.push({
        exerciseName: variant.exerciseName,
        plannedSets: variant.plannedSets,
        plannedReps: variant.plannedReps ?? null,
        plannedSeconds: variant.plannedSeconds ?? null,
      });
    }
    // A day never silently vanishes: it's always pushed. When it's empty we
    // record why so the preview can explain it and the apply path can keep it.
    const emptyReason: BuiltDay['emptyReason'] =
      exercises.length > 0 ? null : droppedInDay ? 'equipment' : 'duration';
    builtDays.push({ name: day.name, exercises, emptyReason });
  }

  if (trimmedAny) {
    if (durationMinutes <= 15) {
      tradeoffs.add(
        '15-min preset keeps only the main lifts. SMR, mobility, and accessories are trimmed — pick a longer duration for those.',
      );
    } else if (durationMinutes === 30) {
      tradeoffs.add(
        '30-min preset trims SMR and the cardio finisher. Bump to 45 for mobility prep, 60 for the full session.',
      );
    } else if (durationMinutes === 45) {
      tradeoffs.add('45-min preset trims SMR. Pick 60 to include foam-rolling at the start.');
    }
  }
  if (droppedAny) {
    tradeoffs.add(
      `Some movement slots were dropped — your available equipment doesn't cover them. Toggle more gear on, or edit the day after to fill the gap.`,
    );
  }
  // Call out whole days the equipment couldn't fill by name, so picking a
  // 3-day split and getting a thin one is never a silent surprise. (Duration-
  // emptied days are covered by the trim messages above and the per-day notice
  // in the preview.)
  const emptyByEquipment = builtDays.filter((d) => d.emptyReason === 'equipment');
  if (emptyByEquipment.length > 0) {
    const names = emptyByEquipment.map((d) => d.name).join(', ');
    tradeoffs.add(
      `Your equipment couldn't fill ${names} — ${
        emptyByEquipment.length === 1 ? 'that day stays' : 'those days stay'
      } empty for you to fill by hand, or add more gear.`,
    );
  }

  return {
    description: base.description,
    days: builtDays,
    tradeoffs: Array.from(tradeoffs),
    needsMat,
  };
}
