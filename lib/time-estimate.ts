// Time estimation for workouts, exercises, and individual sets.
//
// Inputs vary by surface — a planned slot in a template knows plannedSets and
// plannedReps; an active-session set log knows its actual reps once committed
// but maybe not yet. The functions below cover both cases against a single set
// of constants.
//
// Working-time defaults (WORK_PER_REP_S, SET_OVERHEAD_S, etc.) are deliberate
// guesses, calibrated against typical strength-training pacing. They're
// exported so future work — settings sliders, history-derived calibration —
// can hook in without forking a copy. Until then, an estimate within ~15% of
// reality is the goal; we don't pretend to predict any one user's pace
// exactly.
//
// Philosophical note: these numbers describe the user's authored plan back to
// them. They are not deadlines and the UI never frames them as such. See the
// callers — formatting copy says "~24 min" or "at typical pace", never "12:34
// remaining" with a ticking countdown.
//
// All inputs and outputs are seconds; format helpers convert at the edge.

export const TIME_ESTIMATE = {
  // Per-rep ramp time for reps-metric exercises. A typical strength rep with
  // setup, eccentric, and concentric averages ~3s; isolation and high-rep
  // work tends faster, low-rep heavy slower.
  WORK_PER_REP_S: 3,
  // Fixed setup overhead added once per set (rack walk-out, breath, brace).
  SET_OVERHEAD_S: 15,
  // Used when plannedReps is null or 0.
  DEFAULT_REPS: 8,
  // Used when plannedSets is null or 0.
  DEFAULT_SETS: 3,
  // Used when a time-metric exercise has no plannedSeconds (planks, carries).
  DEFAULT_TIME_SET_S: 30,
  // Used when a session has no rest preference resolved (shouldn't happen in
  // practice — prefs always have a default — but guards against undefined).
  DEFAULT_REST_S: 90,
} as const;

type SetWorkInput = {
  metric: string; // 'reps' | 'time'
  plannedReps: number | null;
  plannedSeconds: number | null;
};

/**
 * Working time for a single set, in seconds. This is the part the user spends
 * actually moving the weight (or holding the position) — rest is counted
 * separately by exercise-level helpers.
 */
export function workTimePerSet(input: SetWorkInput): number {
  if (input.metric === 'time') {
    return input.plannedSeconds && input.plannedSeconds > 0
      ? input.plannedSeconds
      : TIME_ESTIMATE.DEFAULT_TIME_SET_S;
  }
  const reps =
    input.plannedReps && input.plannedReps > 0 ? input.plannedReps : TIME_ESTIMATE.DEFAULT_REPS;
  return reps * TIME_ESTIMATE.WORK_PER_REP_S + TIME_ESTIMATE.SET_OVERHEAD_S;
}

type PlannedExercise = SetWorkInput & {
  plannedSets: number | null;
  // The user's effective rest for this exercise — already resolved against
  // any per-exercise override before being passed in.
  restSeconds: number;
};

/**
 * Total time for one exercise as planned: working time per set times the set
 * count, plus rest between (but not after) sets.
 */
export function estimatePlannedExerciseSeconds(ex: PlannedExercise): number {
  const sets = ex.plannedSets && ex.plannedSets > 0 ? ex.plannedSets : TIME_ESTIMATE.DEFAULT_SETS;
  if (sets <= 0) return 0;
  const work = workTimePerSet(ex);
  return sets * work + Math.max(0, sets - 1) * ex.restSeconds;
}

/**
 * Sum across a planned lineup — a routine day's exercises, a template's
 * exercises. The caller resolves rest overrides upstream.
 */
export function estimatePlannedTotalSeconds(exercises: PlannedExercise[]): number {
  return exercises.reduce((sum, ex) => sum + estimatePlannedExerciseSeconds(ex), 0);
}

// ============ ACTIVE SESSION ============

type ActiveSet = {
  reps: number | null;
  seconds: number | null;
};

type ActiveExercise = {
  metric: string;
  restSeconds: number;
  setLogs: ActiveSet[];
};

function isSetFilled(set: ActiveSet, metric: string): boolean {
  return metric === 'time'
    ? set.seconds !== null && set.seconds > 0
    : set.reps !== null && set.reps > 0;
}

function workTimeForSet(set: ActiveSet, metric: string): number {
  // Prefer the user's actual logged value when present — a 3-rep heavy set
  // shouldn't be estimated like a 12-rep accessory.
  if (metric === 'time') {
    return set.seconds && set.seconds > 0 ? set.seconds : TIME_ESTIMATE.DEFAULT_TIME_SET_S;
  }
  const reps = set.reps && set.reps > 0 ? set.reps : TIME_ESTIMATE.DEFAULT_REPS;
  return reps * TIME_ESTIMATE.WORK_PER_REP_S + TIME_ESTIMATE.SET_OVERHEAD_S;
}

/**
 * Total time for one exercise in the active session, treating each existing
 * set log row as a planned set. Filled rows use their actual values; unfilled
 * ones use defaults. Counts rest between consecutive sets within the
 * exercise; no rest is counted after the final set.
 *
 * The model:
 *   workTime(set 1) + rest + workTime(set 2) + rest + ... + workTime(set N)
 *
 * Session-level totals sum these per-exercise estimates so the workout total
 * is exactly the sum of what each card shows — no between-exercise rest is
 * inserted, since the rest timer is per-set and "moving to the next
 * exercise" is the user's own action, not a planned delay.
 */
export function estimateActiveExerciseSeconds(ex: ActiveExercise): number {
  if (ex.setLogs.length === 0) return 0;
  let total = 0;
  for (const set of ex.setLogs) {
    total += workTimeForSet(set, ex.metric);
  }
  total += Math.max(0, ex.setLogs.length - 1) * ex.restSeconds;
  return total;
}

/**
 * Remaining time for one exercise — the work in front of the user given which
 * set logs are still unfilled. A rest period counts toward remaining when
 * either side of it is still unfilled; if both consecutive sets are already
 * logged, the rest between them is in the past.
 */
function estimateActiveExerciseRemainingSeconds(ex: ActiveExercise): number {
  if (ex.setLogs.length === 0) return 0;
  const filled = ex.setLogs.map((s) => isSetFilled(s, ex.metric));
  let work = 0;
  for (let i = 0; i < ex.setLogs.length; i++) {
    if (!filled[i]) work += workTimeForSet(ex.setLogs[i], ex.metric);
  }
  let restAhead = 0;
  for (let i = 0; i < ex.setLogs.length - 1; i++) {
    // The rest between sets i and i+1 is ahead of the user iff at least one
    // of them is still unfilled. Both filled = rest already happened.
    if (!filled[i] || !filled[i + 1]) restAhead += ex.restSeconds;
  }
  return work + restAhead;
}

export type ActiveSessionEstimate = {
  totalSec: number;
  remainingSec: number;
};

/**
 * Total and remaining time for the active session. Both compose the same
 * per-exercise accounting so the header total matches the sum of what each
 * exercise card shows, and remaining never exceeds total.
 */
export function estimateActiveSession(exercises: ActiveExercise[]): ActiveSessionEstimate {
  let totalSec = 0;
  let remainingSec = 0;
  for (const ex of exercises) {
    totalSec += estimateActiveExerciseSeconds(ex);
    remainingSec += estimateActiveExerciseRemainingSeconds(ex);
  }
  return { totalSec, remainingSec };
}

// ============ FORMATTING ============

/**
 * Formats a duration for display. Tuned for "around X minutes" surfaces
 * (routine timeline, exercise card, totals) — not a stopwatch.
 *
 *   45s   → "1 min"   (rounds up; estimates are not stopwatches)
 *   90s   → "2 min"
 *   2700s → "45 min"
 *   3900s → "1h 5m"
 */
export function formatEstimate(seconds: number): string {
  if (seconds <= 0) return '0 min';
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Compact form for tight rows. Uses seconds under a minute so a single set
 * doesn't get rounded to "1 min" when it's really 45 seconds of work.
 *
 *   45s   → "45s"
 *   90s   → "1.5 min"
 *   180s  → "3 min"
 */
export function formatEstimateCompact(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = seconds / 60;
  if (minutes < 10) {
    // Show a half-step under 10 min — "1.5 min" reads less arbitrary
    // than "2 min" when the underlying value is 90s.
    const rounded = Math.round(minutes * 2) / 2;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} min`;
  }
  return formatEstimate(seconds);
}
