// Exercise seed data — a broad library of common, evidence-based strength,
// mobility, and conditioning movements drawn from current best practices in
// the strength-and-conditioning and rehab-coaching space. The starter routines
// (lib/starter-routines.ts) draw from this pool, and users can layer their own
// custom exercises on top. This is the source of truth for built-in exercises.
// Updates here flow into the database via `npm run db:seed` (idempotent upsert).
//
// The library is intentionally generic — not any one program. The user's own
// tailored routine is whatever they assemble from this library and any customs
// they add; the app provides the materials, the user provides the plan.

// Modules are visual chunks within a workout. The order here is the natural
// flow within a single session: prep (SMR → mobility → activation), then load
// (strength), then balance/conditioning at the end. Templates and the active
// session group exercises by module using this ordering.
export const EXERCISE_MODULES = [
  'SMR Lower',
  'SMR Upper',
  'SMR Trunk',
  'Mobility Lower',
  'Mobility Upper',
  'Mobility Trunk',
  'Activation Lower',
  'Activation Upper',
  'Activation Trunk',
  'Strength Barbell',
  'Strength Accessory',
  'Strength Thoracic',
  'Balance',
  'Rev Up',
] as const;

export type ExerciseModule = (typeof EXERCISE_MODULES)[number];

// Short, plain-language explanation for each module. Surfaces under module
// headings (in the picker, the active session, and the routine timeline) so
// users new to terms like SMR or Activation aren't left guessing. Keep these
// to one line — they sit directly under the heading and shouldn't crowd the
// list. The phase ordering ("prep → load → finish") is implicit in the
// EXERCISE_MODULES array order; the descriptions reinforce that arc.
//
// "Custom" is included because user-created exercises share the picker's
// module-grouped layout; falling back gracefully here is simpler than
// guarding every render site.
export const MODULE_INFO: Record<ExerciseModule | 'Custom', { description: string }> = {
  'SMR Lower': {
    description:
      'Self-myofascial release — foam rolling and soft-tissue prep for legs, hips, glutes.',
  },
  'SMR Upper': {
    description:
      'Self-myofascial release — foam rolling and soft-tissue prep for chest, back, arms.',
  },
  'SMR Trunk': {
    description:
      'Self-myofascial release — foam rolling and soft-tissue prep for the torso.',
  },
  'Mobility Lower': {
    description: 'Joint range and dynamic stretches for legs and hips.',
  },
  'Mobility Upper': {
    description: 'Joint range and dynamic stretches for shoulders, neck, and arms.',
  },
  'Mobility Trunk': {
    description: 'Joint range and dynamic stretches for the spine and ribcage.',
  },
  'Activation Lower': {
    description:
      'Light targeted work to wake up glutes and legs before loading them.',
  },
  'Activation Upper': {
    description:
      'Light targeted work to wake up shoulders and back before loading them.',
  },
  'Activation Trunk': {
    description: 'Light targeted work to wake up the core before loading it.',
  },
  'Strength Barbell': {
    description: 'Main loaded lifts — squats, deadlifts, presses, hinges.',
  },
  'Strength Accessory': {
    description: 'Supporting variants and isolation work that backs up the main lifts.',
  },
  'Strength Thoracic': {
    description:
      'Upper-back and postural strength — rows, pulls, scapular work.',
  },
  Balance: {
    description: 'Single-leg and proprioception drills.',
  },
  'Rev Up': {
    description: 'Higher-intensity finishers — sprints, carries, conditioning.',
  },
  Custom: {
    description: 'Exercises you added yourself.',
  },
};

// Helper for the cases where the consumer has a module string that may or
// may not be one of the canonical ones (e.g. legacy data, future custom
// modules). Falls back to an empty description rather than throwing.
export function moduleDescription(module: string): string {
  return (MODULE_INFO as Record<string, { description: string }>)[module]?.description ?? '';
}

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
  // 'reps' (default) or 'time'. Determines whether the set-row UI shows reps or
  // a stopwatch/seconds input. Planks, side planks, holds, wall sits, and
  // farmer carries are 'time'; everything else is 'reps'.
  metric?: 'reps' | 'time';
  // Equipment tokens needed by this exercise. Drives the routine preset
  // picker's equipment-tier filter. Canonical tokens — 'barbell', 'rack',
  // 'bench', 'dumbbells', 'cable', 'machine', 'bands', 'pull-up bar',
  // 'foam roller', 'lacrosse ball', 'bodyweight', 'mat'. Omit for exercises
  // requiring nothing beyond the user's body. 'mat' is informational rather
  // than gating — the picker surfaces it as a small note.
  equipment?: string[];
};

// Equipment tokens used across the seed. Kept as a const array for self-
// documentation; the schema column is a free-form string[] so user customs
// can add their own. The starter-routine picker treats unknown tokens as
// "always available" (fail-open), so a typo here only affects equipment-tier
// filtering, never whether an exercise is reachable at all.
export const KNOWN_EQUIPMENT = [
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
] as const;

export const SEED_EXERCISES: SeedExercise[] = [
  // ============ SMR LOWER ============
  // Soft-tissue work uses the 'soft tissue' muscle id — a recency-only marker
  // (no weekly volume target). Lets coverage show "did I roll out recently?"
  // without crediting foam rolling as hypertrophy work.
  {
    name: 'Foam roll quads',
    module: 'SMR Lower',
    primaryMuscles: ['soft tissue'],
    prescription: '1–2 min per leg, slow passes',
    equipment: ['foam roller', 'mat'],
  },
  {
    name: 'Foam roll IT band / outer thigh',
    module: 'SMR Lower',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min per side, ease into tender spots',
    equipment: ['foam roller', 'mat'],
  },
  {
    name: 'Foam roll glutes / piriformis',
    module: 'SMR Lower',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min per side, lacrosse ball OK for depth',
    equipment: ['foam roller', 'lacrosse ball', 'mat'],
  },
  {
    name: 'Foam roll calves',
    module: 'SMR Lower',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min per leg',
    equipment: ['foam roller', 'mat'],
  },

  // ============ SMR UPPER ============
  {
    name: 'Foam roll T-spine extensions',
    module: 'SMR Upper',
    primaryMuscles: ['soft tissue', 't-spine mobility'],
    prescription: '5–8 slow extensions per spinal segment',
    equipment: ['foam roller', 'mat'],
  },
  {
    name: 'Foam roll lats',
    module: 'SMR Upper',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min per side',
    equipment: ['foam roller', 'mat'],
  },
  {
    name: 'Lacrosse ball pec / anterior shoulder',
    module: 'SMR Upper',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min per side, against a wall',
    equipment: ['lacrosse ball'],
  },

  // ============ SMR TRUNK ============
  {
    name: 'Foam roll obliques',
    module: 'SMR Trunk',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min per side',
    equipment: ['foam roller', 'mat'],
  },
  {
    name: 'Foam roll mid-back',
    module: 'SMR Trunk',
    primaryMuscles: ['soft tissue'],
    prescription: '1 min, slow passes',
    equipment: ['foam roller', 'mat'],
  },

  // ============ ACTIVATION LOWER ============
  {
    name: 'Banded glute bridges with abduction',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '3×12, 5-sec hold at top, 3-sec abduction press',
    equipment: ['bands', 'mat'],
  },
  {
    name: 'Lateral band walks',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×10 each direction',
    equipment: ['bands'],
  },
  {
    name: 'Monster walks',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×10 each direction',
    equipment: ['bands'],
  },
  {
    name: 'Standing banded scissors',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×10',
    equipment: ['bands'],
  },
  {
    name: 'Reverse / walking lunges',
    module: 'Activation Lower',
    primaryMuscles: ['glutes', 'quads'],
    secondaryMuscles: ['hamstrings', 'adductors'],
    prescription: '2×8 per side',
  },
  {
    name: 'Banded clamshells',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    prescription: '2×12 per side',
    equipment: ['bands', 'mat'],
  },
  {
    name: 'Bodyweight glute bridge',
    module: 'Activation Lower',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    prescription: '2×12, 2-sec hold at top',
    equipment: ['mat'],
  },

  // ============ MOBILITY LOWER ============
  {
    name: '90/90 hip switches',
    module: 'Mobility Lower',
    primaryMuscles: ['hip mobility'],
    prescription: '6–8 per side, controlled',
    equipment: ['mat'],
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
    equipment: ['mat'],
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
    equipment: ['mat'],
  },
  {
    name: 'Hamstring strap stretch',
    module: 'Mobility Lower',
    primaryMuscles: ['hamstrings'],
    prescription: '1min per leg, 3 sets, nasal breathing',
    equipment: ['mat', 'bands'],
  },
  {
    name: 'Adductor rocks',
    module: 'Mobility Lower',
    primaryMuscles: ['adductors'],
    prescription: '8–10 per side',
    equipment: ['mat'],
  },

  // ============ MOBILITY UPPER ============
  {
    name: 'Thread the needle',
    module: 'Mobility Upper',
    primaryMuscles: ['t-spine mobility', 'shoulder mobility'],
    prescription: '6–8 per side, controlled',
    equipment: ['mat'],
  },
  {
    name: 'Quadruped T-spine rotations',
    module: 'Mobility Upper',
    primaryMuscles: ['t-spine mobility'],
    prescription: '6–8 per side, hand behind head',
    equipment: ['mat'],
  },
  {
    name: 'Doorway pec stretch',
    module: 'Mobility Upper',
    primaryMuscles: ['shoulder mobility'],
    prescription: '30s per side',
  },
  {
    name: 'Sleeper stretch',
    module: 'Mobility Upper',
    primaryMuscles: ['shoulder mobility'],
    prescription: '30s per side, side-lying',
    equipment: ['mat'],
  },

  // ============ MOBILITY TRUNK ============
  {
    name: "World's greatest stretch",
    module: 'Mobility Trunk',
    primaryMuscles: ['hip mobility', 't-spine mobility'],
    prescription: '5 reaches per side',
  },
  {
    name: 'Cat-cow',
    module: 'Mobility Trunk',
    primaryMuscles: ['t-spine mobility'],
    prescription: '8–10 reps, slow with breath',
    equipment: ['mat'],
  },
  {
    name: 'Supine spinal twist',
    module: 'Mobility Trunk',
    primaryMuscles: ['t-spine mobility'],
    prescription: '30s per side',
    equipment: ['mat'],
  },
  {
    name: "Child's pose with reach",
    module: 'Mobility Trunk',
    primaryMuscles: ['shoulder mobility', 't-spine mobility'],
    prescription: '30s per side, reach hand under',
    equipment: ['mat'],
  },

  // ============ ACTIVATION TRUNK ============
  {
    name: 'Dead bug',
    module: 'Activation Trunk',
    primaryMuscles: ['core'],
    prescription: '2×8 per side, slow with breath',
    equipment: ['mat'],
  },
  {
    name: 'Bird dog',
    module: 'Activation Trunk',
    primaryMuscles: ['core'],
    secondaryMuscles: ['glutes', 'lower back'],
    prescription: '2×8 per side, hold the top',
    equipment: ['mat'],
  },
  {
    name: 'Side plank',
    module: 'Activation Trunk',
    primaryMuscles: ['core'],
    prescription: '2×20–30s per side',
    metric: 'time',
    equipment: ['mat'],
  },
  {
    name: 'Hollow hold',
    module: 'Activation Trunk',
    primaryMuscles: ['core'],
    prescription: '2×20–30s, lower back pressed down',
    metric: 'time',
    equipment: ['mat'],
  },
  {
    name: 'Bird dog hold',
    module: 'Activation Trunk',
    primaryMuscles: ['core'],
    secondaryMuscles: ['glutes', 'lower back'],
    prescription: '2×20s per side, ribs square',
    metric: 'time',
    equipment: ['mat'],
  },
  {
    name: 'Bear hold',
    module: 'Activation Trunk',
    primaryMuscles: ['core'],
    secondaryMuscles: ['shoulders'],
    prescription: '2×20–30s, knees hovering 1 inch',
    metric: 'time',
    equipment: ['mat'],
  },

  // ============ STRENGTH BARBELL ============
  // Main loaded lifts — the canonical squat / hinge / press / row patterns
  // that anchor most strength programs. Equipment is mostly barbell + rack;
  // a trap-bar deadlift is included for users who own one, but the starter-
  // routine builder defaults to conventional/back-squat variants so users
  // without specialty bars aren't pushed toward niche equipment.
  {
    name: 'Trap bar deadlift',
    module: 'Strength Barbell',
    primaryMuscles: ['glutes', 'hamstrings'],
    secondaryMuscles: ['back', 'quads', 'lower back'],
    prescription: '4×5–6, heels loaded, ribs stacked',
    equipment: ['barbell'],
  },
  {
    name: 'Romanian deadlift',
    module: 'Strength Barbell',
    primaryMuscles: ['hamstrings', 'glutes'],
    secondaryMuscles: ['back', 'lower back'],
    prescription: '3–4×6–8, soft knees, push hips back',
    equipment: ['barbell'],
  },
  {
    name: 'Hang clean (above knee)',
    module: 'Strength Barbell',
    primaryMuscles: ['glutes', 'hamstrings', 'back'],
    secondaryMuscles: ['scapular', 'shoulders'],
    prescription: '4–5×3, aggressive triple extension',
    equipment: ['barbell'],
  },
  {
    name: 'Front squat',
    module: 'Strength Barbell',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core', 'scapular', 'adductors'],
    prescription: '3–4×5, upright torso, active T-spine',
    equipment: ['barbell', 'rack'],
  },
  {
    name: 'Back squat',
    module: 'Strength Barbell',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core', 'lower back', 'adductors'],
    prescription: '3–5×5, brace, full depth',
    equipment: ['barbell', 'rack'],
  },
  {
    name: 'Conventional deadlift',
    module: 'Strength Barbell',
    primaryMuscles: ['hamstrings', 'glutes', 'back'],
    secondaryMuscles: ['lower back', 'core'],
    prescription: '3×3–5, hips and shoulders rise together',
    equipment: ['barbell'],
  },
  {
    name: 'Bench press',
    module: 'Strength Barbell',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    prescription: '3–5×5–8, scaps tucked, controlled descent',
    equipment: ['barbell', 'bench', 'rack'],
  },
  {
    name: 'Overhead press',
    module: 'Strength Barbell',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps', 'core'],
    prescription: '3–4×5–8, ribs down, glutes squeezed',
    equipment: ['barbell', 'rack'],
  },
  {
    name: 'Barbell row',
    module: 'Strength Barbell',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3–4×6–10, torso ~45°, pull to lower ribs',
    equipment: ['barbell'],
  },

  // ============ STRENGTH ACCESSORY ============
  // Supporting variants and isolation work covering a wide equipment range —
  // full-gym (cables, machines), home-rack (barbell + DBs), DB-only, bands,
  // and bodyweight. Where the same pattern is offered at multiple tiers
  // (squat: barbell / DB / band / bodyweight), each variant is a distinct
  // entry so coverage / volume math counts the same primary-muscle credit
  // regardless of equipment.
  {
    name: 'Bulgarian squat (seated step away)',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'quads'],
    secondaryMuscles: ['adductors'],
    prescription: '3–4×8 per side',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Lateral bench step-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'quads'],
    prescription: '3–4×8 per side',
    equipment: ['bench'],
  },
  {
    name: 'Eccentric slow step-downs',
    module: 'Strength Accessory',
    primaryMuscles: ['quads'],
    secondaryMuscles: ['glutes'],
    prescription: '3–4×6 per side, 3-sec lower',
    equipment: ['bench'],
  },
  {
    name: 'Bulgarian long-distance squat',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['quads', 'adductors'],
    prescription: '3–4×8 per side',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Physio ball hamstring bridges',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['glutes'],
    prescription: '3×8–10, flutter kicks between sets',
    equipment: ['physio ball', 'mat'],
  },
  {
    name: 'Posterior chain leg lifts (ball)',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'hamstrings'],
    secondaryMuscles: ['lower back'],
    prescription: '3×10, 5-sec hold with band tension',
    equipment: ['physio ball', 'bands'],
  },

  // --- Dumbbell-tier accessories ---
  {
    name: 'Goblet squat',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core', 'adductors'],
    prescription: '3–4×8–12, elbows tucked, upright torso',
    equipment: ['dumbbells'],
  },
  {
    name: 'Dumbbell RDL',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings', 'glutes'],
    secondaryMuscles: ['lower back'],
    prescription: '3×8–10, soft knees, hinge from hips',
    equipment: ['dumbbells'],
  },
  {
    name: 'Dumbbell deadlift',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings', 'glutes', 'back'],
    secondaryMuscles: ['lower back'],
    prescription: '3×8–10, dumbbells outside knees',
    equipment: ['dumbbells'],
  },
  {
    name: 'Dumbbell bench press',
    module: 'Strength Accessory',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    prescription: '3–4×8–12, neutral grip joint-friendly',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Dumbbell shoulder press',
    module: 'Strength Accessory',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps'],
    prescription: '3×8–12, neutral or pronated grip',
    equipment: ['dumbbells'],
  },
  {
    name: 'Seated dumbbell shoulder press',
    module: 'Strength Accessory',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps'],
    prescription: '3×8–12, back supported',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Single-arm dumbbell row',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3–4×8–12 per side, brace on bench',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Chest-supported dumbbell row',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3×10–12, incline bench, low-back-friendly',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Dumbbell walking lunges',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['hamstrings', 'adductors'],
    prescription: '3×8 per leg, knee tracks toes',
    equipment: ['dumbbells'],
  },
  {
    name: 'Dumbbell hip thrust',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    prescription: '3×8–12, pause at top',
    equipment: ['dumbbells', 'bench', 'mat'],
  },
  {
    name: 'Dumbbell skullcrusher',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    prescription: '3×10–12, neutral grip, elbows tracked',
    equipment: ['dumbbells', 'bench'],
  },
  {
    name: 'Dumbbell shrug',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    prescription: '3×10–12, straight up and down',
    equipment: ['dumbbells'],
  },
  {
    name: 'Dumbbell calf raise',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings'],
    prescription: '3×12–15, full stretch',
    equipment: ['dumbbells'],
  },

  // --- Bands-only accessories ---
  {
    name: 'Banded squat',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    prescription: '3×12–15, stand on band, full depth',
    equipment: ['bands'],
  },
  {
    name: 'Banded RDL',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings', 'glutes'],
    prescription: '3×12–15, hinge with band tension',
    equipment: ['bands'],
  },
  {
    name: 'Banded deadlift',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings', 'glutes', 'back'],
    secondaryMuscles: ['lower back'],
    prescription: '3×10–15, stand on band, drive through floor',
    equipment: ['bands'],
  },
  {
    name: 'Banded chest press',
    module: 'Strength Accessory',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    prescription: '3×12–15, anchor behind, press forward',
    equipment: ['bands'],
  },
  {
    name: 'Banded row',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3×12–15, anchor in front, pull to ribs',
    equipment: ['bands'],
  },
  {
    name: 'Banded pulldown',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'lower traps'],
    prescription: '3×10–15, anchor overhead, pull to chest',
    equipment: ['bands'],
  },
  {
    name: 'Banded shoulder press',
    module: 'Strength Accessory',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps'],
    prescription: '3×10–15, stand on band, press overhead',
    equipment: ['bands'],
  },
  {
    name: 'Banded curl',
    module: 'Strength Accessory',
    primaryMuscles: ['biceps'],
    prescription: '3×12–15, stand on band, elbows pinned',
    equipment: ['bands'],
  },
  {
    name: 'Banded tricep extension',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    prescription: '3×12–15, anchor overhead, elbows fixed',
    equipment: ['bands'],
  },
  {
    name: 'Banded hip thrust',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    prescription: '3×10–15, band across hips, pause at top',
    equipment: ['bands', 'bench', 'mat'],
  },
  {
    name: 'Banded lateral raise',
    module: 'Strength Accessory',
    primaryMuscles: ['shoulders'],
    prescription: '3×12–15, light tension',
    equipment: ['bands'],
  },

  // --- Bodyweight-only accessories ---
  {
    name: 'Bodyweight squat',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    prescription: '3×15–20, full depth',
  },
  {
    name: 'Pistol squat (assisted)',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core'],
    prescription: '3×5–8 per side, sit to bench / hold support',
    equipment: ['bench'],
  },
  {
    name: 'Walking lunges',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['hamstrings', 'adductors'],
    prescription: '3×8 per leg, controlled',
  },
  {
    name: 'Reverse lunges',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes', 'quads'],
    secondaryMuscles: ['hamstrings', 'adductors'],
    prescription: '3×10 per side, knee-friendly version of forward lunge',
  },
  {
    name: 'Box step-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    prescription: '3×10 per side, full leg drive',
    equipment: ['bench'],
  },
  {
    name: 'Single-leg RDL',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings', 'glutes'],
    secondaryMuscles: ['lower back'],
    prescription: '3×8 per side, hinge with control',
  },
  {
    name: 'Bodyweight hip thrust',
    module: 'Strength Accessory',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    prescription: '3×12–15, shoulders on bench, drive through heels',
    equipment: ['bench', 'mat'],
  },
  {
    name: 'Knee push-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders'],
    prescription: '3×AMRAP, body straight from knees',
    equipment: ['mat'],
  },
  {
    name: 'Decline push-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['chest', 'shoulders'],
    secondaryMuscles: ['triceps', 'core'],
    prescription: '3×AMRAP, feet on bench',
    equipment: ['bench'],
  },
  {
    name: 'Diamond push-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    secondaryMuscles: ['chest', 'shoulders'],
    prescription: '3×AMRAP, hands close, elbows tracked',
  },
  {
    name: 'Pike push-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps', 'core'],
    prescription: '3×AMRAP, hips high, elbows in',
  },
  {
    name: 'Inverted row',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3×AMRAP, bar low in rack, body straight',
    equipment: ['rack', 'barbell'],
  },
  {
    name: 'Ring rows',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3×AMRAP, adjust angle for difficulty',
    equipment: ['rings'],
  },
  {
    name: 'Chin-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['back', 'biceps'],
    secondaryMuscles: ['lower traps'],
    prescription: '3×AMRAP or weighted 5–8, supinated grip',
    equipment: ['pull-up bar'],
  },
  {
    name: 'Bench dips',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    secondaryMuscles: ['chest', 'shoulders'],
    prescription: '3×AMRAP, hands behind on bench',
    equipment: ['bench'],
  },
  {
    name: 'Dips',
    module: 'Strength Accessory',
    primaryMuscles: ['chest', 'triceps'],
    secondaryMuscles: ['shoulders'],
    prescription: '3×AMRAP or weighted 5–8',
    equipment: ['dip bar'],
  },
  {
    name: 'Wall sit',
    module: 'Strength Accessory',
    primaryMuscles: ['quads'],
    secondaryMuscles: ['glutes'],
    prescription: '3×30–60s, thighs parallel to floor',
    metric: 'time',
  },

  // --- Machine / cable accessories (full-gym tier) ---
  {
    name: 'Pull-ups',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'lower traps'],
    prescription: '3–4×AMRAP or weighted 5–8',
    equipment: ['pull-up bar'],
  },
  {
    name: 'Lat pulldown',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'lower traps'],
    prescription: '3–4×8–12, full stretch at top',
    equipment: ['cable'],
  },
  {
    name: 'Cable row',
    module: 'Strength Accessory',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear delts', 'lower traps'],
    prescription: '3–4×8–12, controlled tempo',
    equipment: ['cable'],
  },
  {
    name: 'Leg press',
    module: 'Strength Accessory',
    primaryMuscles: ['quads', 'glutes'],
    prescription: '3–4×8–12, knees track toes',
    equipment: ['machine'],
  },
  {
    name: 'Leg curl',
    module: 'Strength Accessory',
    primaryMuscles: ['hamstrings'],
    prescription: '3×10–12',
    equipment: ['machine'],
  },
  {
    name: 'Incline dumbbell press',
    module: 'Strength Accessory',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    prescription: '3–4×8–12',
    equipment: ['dumbbells', 'bench'],
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
    equipment: ['dumbbells'],
  },
  {
    name: 'Bicep curl',
    module: 'Strength Accessory',
    primaryMuscles: ['biceps'],
    prescription: '3×8–12',
    equipment: ['dumbbells'],
  },
  {
    name: 'Hammer curl',
    module: 'Strength Accessory',
    primaryMuscles: ['biceps'],
    prescription: '3×10–12, neutral grip',
    equipment: ['dumbbells'],
  },
  {
    name: 'Tricep pushdown',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    prescription: '3×10–15',
    equipment: ['cable'],
  },
  {
    name: 'Overhead tricep extension',
    module: 'Strength Accessory',
    primaryMuscles: ['triceps'],
    prescription: '3×10–12, full stretch overhead',
    equipment: ['dumbbells'],
  },
  {
    name: 'Plank',
    module: 'Strength Accessory',
    primaryMuscles: ['core'],
    prescription: '3×30–60s, ribs down, glutes engaged',
    metric: 'time',
    equipment: ['mat'],
  },

  // ============ STRENGTH THORACIC ============
  // Postural strength for the thoracic spine and surrounding muscles. Pairs
  // naturally with Activation Upper / SMR Upper as a warm-up-into-load arc
  // on upper-body or full-body days.
  {
    name: 'Banded pull-aparts',
    module: 'Strength Thoracic',
    primaryMuscles: ['rear delts', 'scapular'],
    secondaryMuscles: ['lower traps'],
    prescription: '3×12–15, arms straight',
    equipment: ['bands'],
  },
  {
    name: 'Half-kneeling Pallof press',
    module: 'Strength Thoracic',
    primaryMuscles: ['core'],
    secondaryMuscles: ['scapular'],
    prescription: '3×8 per side, anti-rotation',
    equipment: ['bands'],
  },
  {
    name: 'Prone press-ups (cobra)',
    module: 'Strength Thoracic',
    primaryMuscles: ['t-spine mobility'],
    secondaryMuscles: ['lower back'],
    prescription: '2×10, hips down, smooth extension',
    equipment: ['mat'],
  },
  {
    name: 'Reverse fly',
    module: 'Strength Thoracic',
    primaryMuscles: ['rear delts'],
    secondaryMuscles: ['scapular', 'lower traps'],
    prescription: '3×10–12, light DB or band',
    equipment: ['dumbbells'],
  },

  // ============ ACTIVATION UPPER ============
  {
    name: 'Scapular postural band work',
    module: 'Activation Upper',
    primaryMuscles: ['scapular'],
    prescription: '3×10, 5-sec hold, build to 12 then 15',
    equipment: ['bands'],
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
    secondaryMuscles: ['back', 'scapular', 'lower traps'],
    prescription: '2×12',
    equipment: ['bands'],
  },
  {
    name: 'Prone Y raises',
    module: 'Activation Upper',
    primaryMuscles: ['lower traps'],
    prescription: '2×8',
    equipment: ['mat'],
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
    metric: 'time',
    equipment: ['airex pad'],
  },
  {
    name: 'BOSU dome single-leg holds',
    module: 'Balance',
    primaryMuscles: ['balance'],
    prescription: '1min per side, 3 rounds',
    metric: 'time',
    equipment: ['bosu'],
  },
  {
    name: 'BOSU flat single-leg holds',
    module: 'Balance',
    primaryMuscles: ['balance'],
    prescription: '1min per side, 3 rounds',
    metric: 'time',
    equipment: ['bosu'],
  },
  {
    name: 'Single-leg balance hold',
    module: 'Balance',
    primaryMuscles: ['balance'],
    prescription: '3×30s per side, eyes open then closed',
    metric: 'time',
  },

  // ============ REV UP ============
  // Brief conditioning at the end of a session. Cardio uses an 'other'
  // category id with no volume target — recency matters, set count doesn't.
  {
    name: 'Jump rope',
    module: 'Rev Up',
    primaryMuscles: ['cardio'],
    prescription: '1–2 min, light bounce',
    metric: 'time',
    equipment: ['jump rope'],
  },
  {
    name: 'Jumping jacks',
    module: 'Rev Up',
    primaryMuscles: ['cardio'],
    prescription: '30–45s',
    metric: 'time',
  },
  {
    name: 'Mountain climbers',
    module: 'Rev Up',
    primaryMuscles: ['cardio'],
    secondaryMuscles: ['core'],
    prescription: '30–45s, controlled',
    metric: 'time',
    equipment: ['mat'],
  },
  {
    name: 'High knees',
    module: 'Rev Up',
    primaryMuscles: ['cardio'],
    prescription: '30–45s, drive knees up',
    metric: 'time',
  },
  {
    name: 'Burpees',
    module: 'Rev Up',
    primaryMuscles: ['cardio'],
    secondaryMuscles: ['chest', 'core', 'quads'],
    prescription: '3×8–10, full chest-to-floor, jump up',
  },
  {
    name: 'Farmer carry',
    module: 'Rev Up',
    primaryMuscles: ['core'],
    secondaryMuscles: ['back', 'scapular'],
    prescription: '3×30–45s, ribs stacked, walk with intent',
    metric: 'time',
    equipment: ['dumbbells'],
  },
  {
    name: 'Suitcase carry',
    module: 'Rev Up',
    primaryMuscles: ['core'],
    secondaryMuscles: ['back', 'scapular'],
    prescription: '3×30–45s per side, anti-lateral-flexion',
    metric: 'time',
    equipment: ['dumbbells'],
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
  // One-line plain-English description surfaced in coverage tooltips. Tells the
  // user what the muscle is and what kinds of exercises hit it, so the row
  // labels aren't bare jargon. Lower-target ("postural") muscles deliberately
  // call out that the smaller number is by design, not by neglect.
  description?: string;
};

// Defaults are middle-of-the-road hypertrophy targets (~10 sets/week for major
// muscles, ~8 for smaller assistance muscles, lower for corrective/postural work).
// Users can override per-muscle in settings. Not gospel — just a reasonable start.
//
// A note on the lower targets (lower traps 6, lower back 6, adductors 4): those
// numbers reflect that these muscles get a lot of secondary credit from main
// lifts and rarely need dedicated isolation. Lower target ≠ less important —
// it's just less *direct* work needed.
export const MUSCLE_GROUPS: MuscleGroup[] = [
  {
    id: 'glutes',
    label: 'Glutes',
    category: 'lower',
    weeklyVolumeTarget: 12,
    description: 'The primary hip extensor — built by squats, deadlifts, hip thrusts, lunges, and dedicated glute work.',
  },
  {
    id: 'hamstrings',
    label: 'Hamstrings',
    category: 'lower',
    weeklyVolumeTarget: 10,
    description: 'Back-of-thigh hip extensors and knee flexors. Hit by deadlifts, RDLs, leg curls, and lunges.',
  },
  {
    id: 'quads',
    label: 'Quads',
    category: 'lower',
    weeklyVolumeTarget: 10,
    description: 'Front-of-thigh knee extensors. Hit by squats, lunges, leg press, step-ups.',
  },
  {
    id: 'adductors',
    label: 'Adductors',
    category: 'lower',
    weeklyVolumeTarget: 4,
    description: 'Inner-thigh hip stabilizers. Mostly trained as spillover from squats, lunges, and split squats — rarely programmed directly. Lower target reflects the realistic spillover dose.',
  },
  {
    id: 'chest',
    label: 'Chest',
    category: 'upper',
    weeklyVolumeTarget: 10,
    description: 'Pecs — horizontal pushers. Hit by bench press, push-ups, dips, dumbbell press.',
  },
  {
    id: 'back',
    label: 'Back',
    category: 'upper',
    weeklyVolumeTarget: 12,
    description: 'Lats, mid-traps, rhomboids — pulled by rows, pulldowns, pull-ups, deadlifts.',
  },
  {
    id: 'scapular',
    label: 'Scapular stabilizers',
    category: 'upper',
    weeklyVolumeTarget: 8,
    description: 'Small muscles that anchor the shoulder blade. Hit by face pulls, pull-aparts, Y/T raises, prone work. Postural — keeps shoulders healthy.',
  },
  {
    id: 'rear delts',
    label: 'Rear delts',
    category: 'upper',
    weeklyVolumeTarget: 8,
    description: 'Back of the shoulder. Hit by face pulls, reverse fly, pull-aparts, and rows (secondary). Often underdosed when training is bench-heavy.',
  },
  {
    id: 'lower traps',
    label: 'Lower traps',
    category: 'upper',
    weeklyVolumeTarget: 6,
    description: 'Postural muscles between the shoulder blades. Hit by Y raises, face pulls, pull-aparts, and rows (secondary). Lower target — small muscle, big impact on shoulder health.',
  },
  {
    id: 'biceps',
    label: 'Biceps',
    category: 'upper',
    weeklyVolumeTarget: 8,
    description: 'Front of the upper arm. Hit by curls and pulling movements (secondary).',
  },
  {
    id: 'triceps',
    label: 'Triceps',
    category: 'upper',
    weeklyVolumeTarget: 8,
    description: 'Back of the upper arm. Hit by tricep work and pressing movements (secondary).',
  },
  {
    id: 'shoulders',
    label: 'Shoulders',
    category: 'upper',
    weeklyVolumeTarget: 10,
    description: 'Front and side delts — overhead and lateral raising. Hit by overhead press, lateral raises, and bench/push-ups (secondary).',
  },
  {
    id: 'core',
    label: 'Core',
    category: 'trunk',
    weeklyVolumeTarget: 8,
    description: 'Abs and obliques. Hit by planks, hollow holds, carries, and braced compound lifts (secondary).',
  },
  {
    id: 'lower back',
    label: 'Lower back',
    category: 'trunk',
    weeklyVolumeTarget: 6,
    description: 'Spinal erectors. Hit primarily as secondary on deadlifts, RDLs, good mornings, and bird-dog work. Lower target — usually well-served by hinge variants.',
  },
  {
    id: 'balance',
    label: 'Balance',
    category: 'other',
    description: 'Single-leg and proprioception work. Tracked by recency, not volume — once a week is plenty.',
  },
  {
    id: 'cardio',
    label: 'Cardio',
    category: 'other',
    description: 'Conditioning and finishers. Tracked by recency, not volume.',
  },
  {
    id: 'hip mobility',
    label: 'Hip mobility',
    category: 'mobility',
    description: 'Hip range of motion — 90/90s, deep squat reaches, world’s greatest. Recency, not volume.',
  },
  {
    id: 'ankle mobility',
    label: 'Ankle mobility',
    category: 'mobility',
    description: 'Dorsiflexion range — ankle rocks. Helps squat depth. Recency, not volume.',
  },
  {
    id: 'hip flexors',
    label: 'Hip flexors',
    category: 'mobility',
    description: 'Front-of-hip stretch — half-kneeling stretch, couch stretch. Recency, not volume.',
  },
  {
    id: 'shoulder mobility',
    label: 'Shoulder mobility',
    category: 'mobility',
    description: 'Shoulder range — pec stretch, sleeper, child’s pose with reach. Recency, not volume.',
  },
  {
    id: 't-spine mobility',
    label: 'T-spine mobility',
    category: 'mobility',
    description: 'Thoracic-spine rotation and extension — thread-the-needle, cat-cow, T-spine rotations. Recency, not volume.',
  },
  {
    id: 'soft tissue',
    label: 'Soft tissue',
    category: 'mobility',
    description: 'Foam rolling and SMR. Tracks "did I roll out recently?" — recency, not volume.',
  },
];

// Built-in WorkoutTemplate rows are no longer seeded. Users instead pick a
// starter routine in the /routine empty-state, which generates user-owned
// templates per day from the preset in lib/starter-routines.ts. The
// `WorkoutTemplate.isBuiltin` column stays in the schema for now — it's
// effectively dormant since nothing creates rows with isBuiltin=true.
