// Exercise seed data — Edwardo's modular program with Bernadette's additions.
// This is the source of truth for built-in exercises. Updates here flow into
// the database via `npm run db:seed` (idempotent upsert).

export const EXERCISE_MODULES = [
  'Activation Lower',
  'Activation Upper',
  'Mobility Lower',
  'Strength Barbell',
  'Strength Accessory',
  'Balance',
] as const;

export type ExerciseModule = (typeof EXERCISE_MODULES)[number];

export type SeedExercise = {
  name: string;
  module: ExerciseModule;
  prescription: string;
  // Muscles where the exercise is the primary intent (full credit in volume tracking)
  primaryMuscles: string[];
  // Muscles meaningfully worked but not the focus (half credit in volume tracking)
  secondaryMuscles?: string[];
  // Optional demo video — manually populated. Surfaced as a small play icon in the UI.
  videoUrl?: string;
};

export const SEED_EXERCISES: SeedExercise[] = [
  // ============ ACTIVATION LOWER ============
  {
    name: 'Banded glute bridges with abduction',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '3×12, 5-sec hold at top, 3-sec abduction press',
  },
  {
    name: 'Lateral band walks',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×10 each direction',
  },
  {
    name: 'Monster walks',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×10 each direction',
  },
  {
    name: 'Standing banded scissors',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×10',
  },
  {
    name: 'Reverse / walking lunges',
    module: 'Activation Lower',
    primaryMuscles: ['glutes', 'quads'],
    secondaryMuscles: ['hamstrings'],
    prescription: '2×8 per side',
  },

  // ============ MOBILITY LOWER ============
  {
    name: '90/90 hip switches',
    module: 'Mobility Lower',
    primaryMuscles: ['hip mobility'],
    prescription: '6–8 per side, controlled',
  },
  {
    name: 'Deep squat with reach',
    module: 'Mobility Lower',
    primaryMuscles: ['hip mobility', 'ankle mobility'],
    prescription: '5 reaches per side',
  },
  {
    name: 'Half-kneeling hip flexor stretch',
    module: 'Mobility Lower',
    primaryMuscles: ['hip flexors'],
    prescription: '30s per side, with overhead reach',
  },
  {
    name: 'Ankle rocks',
    module: 'Mobility Lower',
    primaryMuscles: ['ankle mobility'],
    prescription: '10 per side',
  },
  {
    name: 'Couch stretch',
    module: 'Mobility Lower',
    primaryMuscles: ['hip flexors'],
    secondaryMuscles: ['quads'],
    prescription: '30–45s per side',
  },
  {
    name: 'Hamstring strap stretch',
    module: 'Mobility Lower',
    primaryMuscles: ['hamstrings'],
    prescription: '1min per leg, 3 sets, nasal breathing',
  },
  {
    name: 'Adductor rocks',
    module: 'Mobility Lower',
    primaryMuscles: ['adductors'],
    prescription: '8–10 per side',
  },

  // ============ STRENGTH BARBELL ============
  {
    name: 'Trap bar deadlift',
    module: 'Strength Barbell',
    primaryMuscles: ['glutes', 'hamstrings'],
    secondaryMuscles: ['back', 'quads', 'lower back'],
    prescription: '4×5–6, heels loaded, ribs stacked',
  },
  {
    name: 'Romanian deadlift',
    module: 'Strength Barbell',
    primaryMuscles: ['hamstrings', 'glutes'],
    secondaryMuscles: ['back', 'lower back'],
    prescription: '3–4×6–8, soft knees, push hips back',
  },
  {
    name: 'Hang clean (above knee)',
    module: 'Strength Barbell',
    primaryMuscles: ['glutes', 'hamstrings', 'back'],
    secondaryMuscles: ['scapular', 'shoulders'],
    prescription: '4–5×3, aggressive triple extension',
  },
  {
    name: 'Front squat',
    module: 'Strength Barbell',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core', 'scapular'],
    prescription: '3–4×5, upright torso, active T-spine',
  },

  // ============ STRENGTH ACCESSORY ============
  {
    name: 'Bulgarian squat (seated step away)',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'quads'],
    prescription: '3–4×8 per side',
  },
  {
    name: 'Lateral bench step-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'quads'],
    prescription: '3–4×8 per side',
  },
  {
    name: 'Eccentric slow step-downs',
    module: 'Strength Accessory',
    primaryMuscles: ['quads'],
    secondaryMuscles: ['glutes'],
    prescription: '3–4×6 per side, 3-sec lower',
  },
  {
    name: 'Bulgarian long-distance squat',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['quads'],
    prescription: '3–4×8 per side',
  },
  {
    name: 'Physio ball hamstring bridges',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['glutes'],
    prescription: '3×8–10, flutter kicks between sets',
  },
  {
    name: 'Posterior chain leg lifts (ball)',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'hamstrings'],
    secondaryMuscles: ['lower back'],
    prescription: '3×10, 5-sec hold with band tension',
  },

  // ============ ACTIVATION UPPER ============
  {
    name: 'Scapular postural band work',
    module: 'Activation Upper',
    primaryMuscles: ['scapular'],
    prescription: '3×10, 5-sec hold, build to 12 then 15',
  },
  {
    name: 'Leaning wall push',
    module: 'Activation Upper',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['scapular'],
    prescription: '2×10',
  },
  {
    name: 'Banded face pulls',
    module: 'Activation Upper',
    primaryMuscles: ['rear delts'],
    secondaryMuscles: ['back'],
    prescription: '2×12',
  },
  {
    name: 'Prone Y raises',
    module: 'Activation Upper',
    primaryMuscles: ['lower traps'],
    prescription: '2×8',
  },
  {
    name: 'Scapular wall slides',
    module: 'Activation Upper',
    primaryMuscles: ['scapular'],
    prescription: '2×8',
  },

  // ============ BALANCE ============
  {
    name: 'Airex pad single-leg holds',
    module: 'Balance',
    primaryMuscles: ['balance'],
    prescription: '1min per side, alternating, 3 rounds',
  },
  {
    name: 'BOSU dome single-leg holds',
    module: 'Balance',
    primaryMuscles: ['balance'],
    prescription: '1min per side, 3 rounds',
  },
  {
    name: 'BOSU flat single-leg holds',
    module: 'Balance',
    primaryMuscles: ['balance'],
    prescription: '1min per side, 3 rounds',
  },

  // ============ COMMON STRENGTH BARBELL ============
  // Mainstream gym lifts. Added on top of the original program so the starter
  // templates (Push / Pull / Upper / Lower / Full body) have real content to
  // pull from. Prescriptions are middle-of-the-road defaults, not gospel.
  {
    name: 'Back squat',
    module: 'Strength Barbell',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core', 'lower back'],
    prescription: '3–5×5, brace, full depth',
  },
  {
    name: 'Conventional deadlift',
    module: 'Strength Barbell',
    primaryMuscles: ['hamstrings', 'glutes', 'back'],
    secondaryMuscles: ['lower back', 'core'],
    prescription: '3×3–5, hips and shoulders rise together',
  },
  {
    name: 'Bench press',
    module: 'Strength Barbell',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    prescription: '3–5×5–8, scaps tucked, controlled descent',
  },
  {
    name: 'Overhead press',
    module: 'Strength Barbell',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps', 'core'],
    prescription: '3–4×5–8, ribs down, glutes squeezed',
  },
  {
    name: 'Barbell row',
    module: 'Strength Barbell',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts'],
    prescription: '3–4×6–10, torso ~45°, pull to lower ribs',
  },

  // ============ COMMON STRENGTH ACCESSORY ============
  {
    name: 'Pull-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps'],
    prescription: '3–4×AMRAP or weighted 5–8',
  },
  {
    name: 'Lat pulldown',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps'],
    prescription: '3–4×8–12, full stretch at top',
  },
  {
    name: 'Incline dumbbell press',
    module: 'Strength Accessory',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    prescription: '3–4×8–12',
  },
  {
    name: 'Push-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders', 'core'],
    prescription: '3×AMRAP, body straight',
  },
  {
    name: 'Lateral raises',
    module: 'Strength Accessory',
    primaryMuscles: ['shoulders'],
    prescription: '3–4×10–15, light, controlled',
  },
  {
    name: 'Bicep curl',
    module: 'Strength Accessory',
    primaryMuscles: ['biceps'],
    prescription: '3×8–12',
  },
  {
    name: 'Hammer curl',
    module: 'Strength Accessory',
    primaryMuscles: ['biceps'],
    prescription: '3×10–12, neutral grip',
  },
  {
    name: 'Tricep pushdown',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    prescription: '3×10–15',
  },
  {
    name: 'Leg curl',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings'],
    prescription: '3×10–12',
  },
  {
    name: 'Plank',
    module: 'Strength Accessory',
    primaryMuscles: ['core'],
    prescription: '3×30–60s, ribs down, glutes engaged',
  },
];

// ================================================================
// MUSCLE GROUPS — used by the Coverage view and volume tracking
// ================================================================

export type MuscleCategory = 'lower' | 'upper' | 'trunk' | 'mobility' | 'other';

export type MuscleGroup = {
  id: string;
  label: string;
  category: MuscleCategory;
  // Weekly sets target as a sensible default. Per-user overrides live in the
  // UserVolumeTarget table. Undefined for mobility/balance — those are
  // frequency-based and tracked through the Coverage view, not volume.
  weeklyVolumeTarget?: number;
};

// Defaults are middle-of-the-road hypertrophy targets (~10 sets/week for major
// muscles, ~8 for smaller assistance muscles, lower for corrective/postural work).
// Users can override per-muscle in settings. Not gospel — just a reasonable start.
export const MUSCLE_GROUPS: MuscleGroup[] = [
  { id: 'glutes', label: 'Glutes', category: 'lower', weeklyVolumeTarget: 12 },
  { id: 'hamstrings', label: 'Hamstrings', category: 'lower', weeklyVolumeTarget: 10 },
  { id: 'quads', label: 'Quads', category: 'lower', weeklyVolumeTarget: 10 },
  { id: 'adductors', label: 'Adductors', category: 'lower', weeklyVolumeTarget: 6 },
  { id: 'chest', label: 'Chest', category: 'upper', weeklyVolumeTarget: 10 },
  { id: 'back', label: 'Back', category: 'upper', weeklyVolumeTarget: 12 },
  { id: 'scapular', label: 'Scapular stabilizers', category: 'upper', weeklyVolumeTarget: 8 },
  { id: 'rear delts', label: 'Rear delts', category: 'upper', weeklyVolumeTarget: 8 },
  { id: 'lower traps', label: 'Lower traps', category: 'upper', weeklyVolumeTarget: 6 },
  { id: 'biceps', label: 'Biceps', category: 'upper', weeklyVolumeTarget: 8 },
  { id: 'triceps', label: 'Triceps', category: 'upper', weeklyVolumeTarget: 8 },
  { id: 'shoulders', label: 'Shoulders', category: 'upper', weeklyVolumeTarget: 10 },
  { id: 'core', label: 'Core', category: 'trunk', weeklyVolumeTarget: 8 },
  { id: 'lower back', label: 'Lower back', category: 'trunk', weeklyVolumeTarget: 6 },
  { id: 'balance', label: 'Balance', category: 'other' },
  { id: 'hip mobility', label: 'Hip mobility', category: 'mobility' },
  { id: 'ankle mobility', label: 'Ankle mobility', category: 'mobility' },
  { id: 'hip flexors', label: 'Hip flexors', category: 'mobility' },
];

// ================================================================
// STARTER TEMPLATES — built-in workout templates seeded for every user
// ================================================================
//
// These are global (WorkoutTemplate.userId = null, isBuiltin = true). Users
// see them in their list alongside their own templates and can hide any they
// don't want via UserHiddenTemplate (settings page → Hidden default templates).
// They can't delete them.
//
// Each entry references SEED_EXERCISES by name. The seed reconciles the
// exercise list on every run — if a name changes here without a corresponding
// rename in SEED_EXERCISES, that exercise is silently skipped.
//
// Names are intentionally neutral (Upper body, Lower body, Push, Pull, Full
// body) — these are starting points, not prescriptions. The user's own
// templates live alongside them and should feel like the same kind of object.

export type StarterTemplate = {
  name: string;
  description: string;
  // Display order matches array order. Each name must match a SEED_EXERCISES.name.
  exerciseNames: string[];
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: 'Upper body',
    description: 'A balanced push + pull session for upper body.',
    exerciseNames: [
      'Bench press',
      'Barbell row',
      'Overhead press',
      'Pull-ups',
      'Bicep curl',
      'Tricep pushdown',
    ],
  },
  {
    name: 'Lower body',
    description: 'Squat, hinge, and accessory work for legs and glutes.',
    exerciseNames: [
      'Back squat',
      'Conventional deadlift',
      'Bulgarian squat (seated step away)',
      'Leg curl',
      'Banded glute bridges with abduction',
    ],
  },
  {
    name: 'Push',
    description: 'Chest, shoulders, and triceps.',
    exerciseNames: [
      'Bench press',
      'Overhead press',
      'Incline dumbbell press',
      'Lateral raises',
      'Tricep pushdown',
      'Push-ups',
    ],
  },
  {
    name: 'Pull',
    description: 'Back, biceps, and rear delts.',
    exerciseNames: [
      'Pull-ups',
      'Barbell row',
      'Lat pulldown',
      'Bicep curl',
      'Hammer curl',
      'Banded face pulls',
    ],
  },
  {
    name: 'Full body',
    description: 'One movement from each major pattern.',
    exerciseNames: [
      'Conventional deadlift',
      'Bench press',
      'Pull-ups',
      'Back squat',
      'Overhead press',
      'Plank',
    ],
  },
];
