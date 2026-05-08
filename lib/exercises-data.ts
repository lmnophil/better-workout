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
