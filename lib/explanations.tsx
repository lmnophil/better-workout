// Domain-vocabulary explainers reused across the app's InfoTooltip surfaces.
// Each export is a small JSX fragment — paragraph(s) of plain language plus
// optional examples. Keep them short: the popover is ~20rem wide and the user
// is mid-task. If a concept needs more than three short paragraphs, it
// probably belongs in a dedicated doc, not a tooltip.
//
// Live in lib/ rather than co-located so the routine editor, the workout
// view, the coverage view, and settings can all reach for the same canonical
// copy without duplicating it.

import type { ReactNode } from 'react';

// ============================================================
// EFFORT / FATIGUE
// ============================================================

export const ExplainRPE: ReactNode = (
  <>
    <p>
      <strong>Rate of Perceived Exertion</strong> — how hard a set felt, on a 1–10 scale.
    </p>
    <p>
      <strong>10</strong> = couldn&apos;t do another rep. <strong>9</strong> = one in the tank.{' '}
      <strong>8</strong> = two in the tank. Most working sets live at 7–9; warm-ups at 5–6.
    </p>
    <p>
      Logging this in a note helps you tell &quot;3×8&quot; that felt easy apart from
      &quot;3×8&quot; that nearly buried you — even though the numbers are identical.
    </p>
  </>
);

export const ExplainRIR: ReactNode = (
  <>
    <p>
      <strong>Reps In Reserve</strong> — how many more reps you could have done before failure.
    </p>
    <p>
      The mirror image of RPE. <strong>RIR 0</strong> = failure, <strong>RIR 1</strong> = one left,
      <strong> RIR 2</strong> = two left. Productive sets sit at 0–3 RIR; warm-ups deliberately keep
      more in reserve.
    </p>
  </>
);

// ============================================================
// VOLUME (sets per muscle per week)
// ============================================================

export const ExplainWeeklyVolume: ReactNode = (
  <>
    <p>
      <strong>Weekly volume</strong> is how many working sets you did per muscle in the last 7 days.
      Hypertrophy research treats sets as the most reliable dose unit — more reliable than tonnage
      or time-under-tension.
    </p>
    <p>
      Exercises count <strong>1×</strong> for muscles they primarily train and <strong>0.5×</strong>{' '}
      for muscles they secondarily train. A bench press is 1 chest set + 0.5 triceps + 0.5
      front-delt.
    </p>
  </>
);

export const ExplainVolumeTiers: ReactNode = (
  <>
    <p>
      Three presets scale every muscle&apos;s minimum and target.{' '}
      <strong>You pick the tier that matches the volume you want to chase</strong> — there&apos;s no
      &quot;right&quot; answer for everyone.
    </p>
    <p>
      <strong>Maintenance</strong> halves both bounds — keeping fitness with short sessions.{' '}
      <strong>Balanced</strong> is the canonical 3–5 day routine target. <strong>Athlete</strong>{' '}
      keeps the floor at the balanced target but pushes the stretch goal 50% higher.
    </p>
    <p>
      Loosely tracks the sports-science <strong>MEV / MAV / MRV</strong> framing — minimum effective
      dose, hypertrophy sweet spot, and the upper bound before recovery breaks down.
    </p>
  </>
);

export const ExplainMinTarget: ReactNode = (
  <>
    <p>
      Every tracked muscle has a <strong>minimum</strong> (the floor — below this you&apos;re
      under-stimulating) and a <strong>target</strong> (the dose that drives progress for your
      tier).
    </p>
    <p>
      The min auto-derives at ~50% of the target. The thin grey line in each volume bar marks the
      minimum; the bar fills to the target.
    </p>
  </>
);

export const ExplainPrimarySecondary: ReactNode = (
  <>
    <p>
      Each exercise lists <strong>primary</strong> muscles (its main intent — full credit in weekly
      volume) and <strong>secondary</strong> muscles (meaningfully worked but not the focus — half
      credit).
    </p>
    <p>
      Example: barbell row is <em>primary</em> lats &amp; mid-back, <em>secondary</em> biceps &amp;
      rear delts. A set of rows counts as 1.0 for lats and 0.5 for biceps.
    </p>
  </>
);

// ============================================================
// COVERAGE STATUS TIERS (per-muscle, weekly)
// ============================================================

export const ExplainCoverageTiers: ReactNode = (
  <>
    <p>How this muscle&apos;s sets this week compare to your tier&apos;s min and target:</p>
    <ul className="space-y-1 ml-0.5">
      <li>
        <strong>Gap</strong> — zero sets logged this week. Not necessarily a problem (could be a
        deload), but worth noticing.
      </li>
      <li>
        <strong>Below min</strong> — under the floor. Most users want to add work.
      </li>
      <li>
        <strong>Good</strong> — past the minimum, on the way to target. A solid maintenance dose.
      </li>
      <li>
        <strong>On target</strong> — you hit the prescribed dose for your tier.
      </li>
      <li>
        <strong>Emphasis</strong> — well above target (1.5×+). Often deliberate specialization or a
        lagging-part block; flagged so you notice, not as a problem.
      </li>
    </ul>
  </>
);

// ============================================================
// RECENCY TIERS (per-muscle, days since last worked)
// ============================================================

export const ExplainRecencyTiers: ReactNode = (
  <>
    <p>How long it&apos;s been since you trained this muscle:</p>
    <ul className="space-y-1 ml-0.5">
      <li>
        <strong>Recent</strong> — within 2 days. Likely still recovering.
      </li>
      <li>
        <strong>Good</strong> — 3–4 days. Typical mid-week status.
      </li>
      <li>
        <strong>Stale</strong> — 5–7 days. Worth re-touching.
      </li>
      <li>
        <strong>Neglected</strong> — 8+ days. The muscle is detraining.
      </li>
      <li>
        <strong>Never</strong> — no logged sets ever for this muscle.
      </li>
    </ul>
    <p>
      Independent from weekly volume — &quot;did I work this lately?&quot; is a different question
      than &quot;am I doing enough?&quot;
    </p>
  </>
);

// ============================================================
// REST
// ============================================================

export const ExplainRestRanges: ReactNode = (
  <>
    <p>Rough rest-by-goal heuristics from the strength &amp; hypertrophy literature:</p>
    <ul className="space-y-1 ml-0.5">
      <li>
        <strong>30–60s</strong> — metabolic / muscular endurance, accessory pump work.
      </li>
      <li>
        <strong>60–120s</strong> — hypertrophy (most isolation work, accessory compounds).
      </li>
      <li>
        <strong>2–4 min</strong> — heavy compounds where strength output matters: squats, presses,
        deadlifts, rows.
      </li>
    </ul>
    <p>
      Shorter is not &quot;more efficient&quot; — under-rested heavy sets just produce worse sets.
    </p>
  </>
);

// ============================================================
// PROGRESSIVE OVERLOAD
// ============================================================

export const ExplainWeightIncrement: ReactNode = (
  <>
    <p>
      The smallest weight jump you&apos;d realistically add to this exercise. The +/- buttons in the
      workout view step by exactly this amount, so what feels right depends on the lift.
    </p>
    <ul className="space-y-1 ml-0.5">
      <li>
        <strong>1–2.5 lb</strong> — small isolation work (curls, lateral raises), where adding 5 lb
        is the difference between &quot;hard&quot; and &quot;impossible.&quot;
      </li>
      <li>
        <strong>5 lb</strong> — most accessory compounds (rows, presses, RDLs).
      </li>
      <li>
        <strong>10 lb</strong> — heavy lower-body work (squats, deadlifts) where a single plate
        feels like nothing.
      </li>
    </ul>
    <p>
      <strong>Progressive overload</strong> — adding weight, reps, or sets over time — is what
      drives strength and size adaptations. The increment is just the unit you progress in.
    </p>
  </>
);

// ============================================================
// ROUTINE STRUCTURE — the SMR → Mobility → … → Rev Up sequence
// ============================================================

export const ExplainScheduleStyle: ReactNode = (
  <>
    <p>
      <strong>Cycle</strong> rotates your days in order, at your own pace. Finish Day 1, then Day 2
      is next regardless of which weekday it is. Good for self-paced training, recovery-driven
      schedules, and people whose week doesn&apos;t repeat cleanly.
    </p>
    <p>
      <strong>Calendar</strong> pins each day to a specific weekday. Tuesday is always lower body,
      Thursday is always upper, etc. Good if your life is structured around a fixed weekly grid.
    </p>
    <p>
      Switching modes keeps your days but clears any weekday pins — your day order is preserved.
    </p>
  </>
);

export const ExplainDayDescription: ReactNode = (
  <>
    <p>
      A short note framing what this day is <em>for</em> — emphasis, intent, intended duration, cues
      you want top-of-mind. Visible while you&apos;re lifting; not a prescription.
    </p>
    <p>
      Example:{' '}
      <em>
        &quot;Lower emphasis (glute drive). Stack ~60 min: SMR → Mobility → Activation → Strength →
        Rev Up. Push the hinge today.&quot;
      </em>
    </p>
  </>
);

export const ExplainModuleSequence: ReactNode = (
  <>
    <p>Each day can stack any subset of these in order:</p>
    <ul className="space-y-1 ml-0.5">
      <li>
        <strong>SMR</strong> — Self-Myofascial Release. Foam rolling and soft-tissue prep.
      </li>
      <li>
        <strong>Mobility</strong> — joint range and dynamic stretches.
      </li>
      <li>
        <strong>Activation</strong> — light targeted work to wake up the muscles you&apos;re about
        to load.
      </li>
      <li>
        <strong>Strength</strong> — the main loaded lifts.
      </li>
      <li>
        <strong>Balance</strong> — single-leg and proprioception drills.
      </li>
      <li>
        <strong>Rev Up</strong> — higher-intensity finishers: sprints, carries, conditioning.
      </li>
    </ul>
    <p>
      You don&apos;t need every module every day — a pure strength day might skip Mobility and Rev
      Up; a recovery day might be SMR + Mobility only.
    </p>
  </>
);
