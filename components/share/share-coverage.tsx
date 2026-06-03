'use client';

// Read-only coverage panel for the share view, plus a suggestion-diff helper.
// Two responsibilities, one file because they share the same projection
// logic — applying a suggestion is the only way to compute a coverage delta,
// and the panel renders the base totals the same diff uses as its starting
// point.
//
// The panel mirrors the routine editor's CoveragePanel layout but takes
// already-computed inputs instead of recomputing them — the share owner's
// tier and overrides are resolved server-side and shipped in.

import { useMemo } from 'react';
import {
  ESTIMATED_SETS_FALLBACK,
  TIER_VISUALS,
  VOLUME_TIER_LABELS,
  computeRoutineVolumes,
  formatSets,
  tierFor as coverageTierFor,
  type CoverageTier,
  type ExerciseMuscleShape,
  type MuscleVolumes,
  type VolumeTier,
} from '@/lib/coverage';
import type { RoutineForShare } from './share-view';

export type ShareMuscleGroup = {
  id: string;
  label: string;
  category: 'lower' | 'upper' | 'trunk' | 'mobility' | 'other';
  min: number | null;
  target: number | null;
  isOverridden: boolean;
  description: string | null;
};

const CATEGORY_LABEL: Record<ShareMuscleGroup['category'], string> = {
  lower: 'Lower body',
  upper: 'Upper body',
  trunk: 'Core & trunk',
  mobility: 'Mobility',
  other: 'Other',
};

function boundsOf(m: ShareMuscleGroup): { min: number; target: number } | null {
  if (m.target === null || m.target === 0) return null;
  return { min: m.min ?? Math.round(m.target * 0.5), target: m.target };
}

export function tierOf(sets: number, m: ShareMuscleGroup): CoverageTier {
  return coverageTierFor(sets, boundsOf(m));
}

// ============================================================
// READ-ONLY PANEL
// ============================================================

export function ShareCoveragePanel({
  muscleGroups,
  totals,
  anyEstimated,
  ownerTier,
  ownerName,
}: {
  muscleGroups: ShareMuscleGroup[];
  totals: MuscleVolumes;
  anyEstimated: boolean;
  ownerTier: VolumeTier;
  ownerName: string;
}) {
  const byCategory = useMemo(() => {
    const groups = new Map<ShareMuscleGroup['category'], ShareMuscleGroup[]>();
    for (const m of muscleGroups) {
      let bucket = groups.get(m.category);
      if (!bucket) {
        bucket = [];
        groups.set(m.category, bucket);
      }
      bucket.push(m);
    }
    return groups;
  }, [muscleGroups]);

  const summary = useMemo(() => {
    let target = 0;
    let ok = 0;
    let under = 0;
    let gap = 0;
    let emphasis = 0;
    for (const m of muscleGroups) {
      const b = boundsOf(m);
      if (b === null) continue;
      const sets = totals.get(m.id)?.sets ?? 0;
      const t = coverageTierFor(sets, b);
      if (t === 'target') target++;
      else if (t === 'ok') ok++;
      else if (t === 'under') under++;
      else if (t === 'gap') gap++;
      else if (t === 'emphasis') emphasis++;
    }
    return { target, ok, under, gap, emphasis };
  }, [muscleGroups, totals]);

  const summaryItems = (
    [
      { tier: 'target', label: 'on target', count: summary.target },
      { tier: 'ok', label: 'good', count: summary.ok },
      { tier: 'under', label: 'below min', count: summary.under },
      { tier: 'gap', label: 'gap', count: summary.gap },
      { tier: 'emphasis', label: 'emphasis', count: summary.emphasis },
    ] satisfies { tier: CoverageTier; label: string; count: number }[]
  ).filter((i) => i.count > 0);

  return (
    <section className="px-5 py-5 border-b border-ink-800">
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">Coverage</div>
          <h2 className="font-display text-xl mt-0.5">What the routine hits</h2>
        </div>
        <span
          className="text-[10px] text-ink-500 shrink-0"
          title={`${ownerName} sets their volume tier in Settings. Tier scales muscle (min, target) bounds.`}
        >
          tier: {VOLUME_TIER_LABELS[ownerTier]}
        </span>
      </div>
      <p className="text-[11px] text-ink-400 italic font-display mb-3 leading-relaxed">
        Weighted sets per muscle across one full cycle — primary 1.0, secondary 0.5.
        {anyEstimated && (
          <> Exercises without planned sets are estimated at {ESTIMATED_SETS_FALLBACK}.</>
        )}
      </p>

      {summaryItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {summaryItems.map((i) => {
            const tok = TIER_VISUALS[i.tier];
            return (
              <span
                key={i.tier}
                className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-full border"
                style={{ background: tok.bg, borderColor: tok.border }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: tok.dot }} />
                <span className="text-ink-200">{i.count}</span>
                <span className="text-ink-400">{i.label}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        {Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat}>
            <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1.5">
              {CATEGORY_LABEL[cat]}
            </div>
            <div className="space-y-1">
              {items.map((m) => (
                <ShareCoverageRow key={m.id} muscle={m} sets={totals.get(m.id)?.sets ?? 0} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShareCoverageRow({ muscle, sets }: { muscle: ShareMuscleGroup; sets: number }) {
  const target = muscle.target;
  const min = muscle.min;
  const hasTarget = target !== null && target > 0;
  const ratio = hasTarget ? Math.min(sets / target, 1) : 0;
  const minRatio = hasTarget && min !== null && min > 0 ? Math.min(min / target, 1) : 0;
  const tier = tierOf(sets, muscle);
  const tok = TIER_VISUALS[tier];

  return (
    <div
      className="border rounded px-2.5 py-1.5 flex items-center gap-3"
      style={{ background: tok.bg, borderColor: tok.border }}
      title={muscle.description ? `${muscle.label} — ${muscle.description}` : muscle.label}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: tok.dot }}
        aria-hidden="true"
      />
      <span className="text-[12px] text-ink-100 truncate flex-1 min-w-0">{muscle.label}</span>
      {hasTarget ? (
        <>
          <div className="relative flex-1 max-w-[120px] h-1.5 bg-ink-900 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(ratio * 100, sets > 0 ? 4 : 0)}%`,
                background: tok.bar,
              }}
            />
            {minRatio > 0 && minRatio < 1 && (
              <div
                className="absolute top-[-2px] bottom-[-2px] w-px bg-ink-500/60"
                style={{ left: `${minRatio * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-ink-400 shrink-0 w-16 text-right">
            {formatSets(sets)}/{muscle.target}
          </span>
        </>
      ) : (
        <span className="font-mono text-[10px] text-ink-500 shrink-0">
          {sets > 0 ? `${formatSets(sets)} sets` : '—'}
        </span>
      )}
    </div>
  );
}

// ============================================================
// SUGGESTION DIFF
// ============================================================
//
// Given a routine + a posted suggestion, compute the per-muscle volume change
// the suggestion would produce. Returns null when the suggestion's effect
// can't be deterministically computed (swap_anyof, swap_category, holistic_*)
// — the owner picks the final action, so the diff would be a range, not a
// number. UI surfaces a "varies by pick" badge in that case instead.

export type SuggestionDelta = {
  muscleId: string;
  label: string;
  before: number;
  after: number;
  tierBefore: CoverageTier;
  tierAfter: CoverageTier;
};

export type SuggestionDiffResult =
  | { kind: 'deterministic'; deltas: SuggestionDelta[] }
  | { kind: 'no-change' }
  | { kind: 'variable' } // owner picks among multiple options
  | { kind: 'unsupported' }; // stickers / holistic — no muscle math implied

export function computeSuggestionDiff(args: {
  routine: RoutineForShare;
  suggestion: { kind: string; payload: Record<string, unknown>; targetId: string | null };
  exerciseLookup: Map<string, ExerciseMuscleShape>;
  muscleGroups: ShareMuscleGroup[];
  baseTotals: MuscleVolumes;
}): SuggestionDiffResult {
  const { routine, suggestion, exerciseLookup, muscleGroups, baseTotals } = args;
  const payload = suggestion.payload;
  const kind = suggestion.kind;

  // Apply the suggestion to a draft copy of the routine. Each branch mutates
  // `nextDays` and breaks out; if we can't deterministically apply, return a
  // non-deterministic result tag so the UI shows a softer label.
  const nextDays: PlannedDay[] = routine.days.map((d) => ({
    id: d.id,
    exercises: d.exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      plannedSets: ex.plannedSets,
      poolId: ex.poolId,
    })),
    pools: d.pools,
  }));

  switch (kind) {
    case 'swap_specific': {
      const outId = str(payload.outExerciseId);
      const inId = str(payload.inExerciseId);
      if (!outId || !inId) return { kind: 'unsupported' };
      let touched = false;
      for (const d of nextDays) {
        for (const ex of d.exercises) {
          if (ex.exerciseId === outId) {
            ex.exerciseId = inId;
            touched = true;
          }
        }
      }
      if (!touched) return { kind: 'no-change' };
      break;
    }
    case 'swap_anyof':
    case 'swap_category':
      return { kind: 'variable' };
    case 'remove': {
      const tplExId = str(payload.templateExerciseId) ?? suggestion.targetId;
      if (!tplExId) return { kind: 'unsupported' };
      // The suggestion's `templateExerciseId` doesn't map 1:1 to our flat
      // `exerciseId` in PlannedDay — TemplateExercise rows wrap Exercise. Find
      // by walking the original routine to learn which exerciseId to drop on
      // which day.
      const target = findByTemplateExerciseId(routine, tplExId);
      if (!target) return { kind: 'unsupported' };
      const day = nextDays.find((d) => d.id === target.dayId);
      if (!day) return { kind: 'unsupported' };
      // Remove only the first match — same exercise can appear once per day
      // in normal use, but be defensive.
      const idx = day.exercises.findIndex((e) => e.exerciseId === target.exerciseId);
      if (idx < 0) return { kind: 'no-change' };
      day.exercises.splice(idx, 1);
      break;
    }
    case 'insert': {
      const dayId = suggestion.targetId;
      const exerciseIds = arrStr(payload.exerciseIds);
      if (!dayId || !exerciseIds || exerciseIds.length === 0) return { kind: 'unsupported' };
      const day = nextDays.find((d) => d.id === dayId);
      if (!day) return { kind: 'unsupported' };
      for (const id of exerciseIds) {
        // Inserted exercises are planned at the seeder fallback so the diff
        // matches what the owner would see if they applied the suggestion
        // without further editing.
        day.exercises.push({ exerciseId: id, plannedSets: null });
      }
      break;
    }
    case 'reorder':
      // Reorder doesn't change muscle math — sets/exercises are the same.
      return { kind: 'no-change' };
    case 'sticker': {
      // Only stickers that change set count materially affect volume. Others
      // (more_reps, more_weight, bodyweight) leave the set count unchanged.
      const sticker = str(payload.sticker);
      if (sticker !== 'more_sets' && sticker !== 'fewer_sets') return { kind: 'unsupported' };
      const tplExId = suggestion.targetId;
      if (!tplExId) return { kind: 'unsupported' };
      const target = findByTemplateExerciseId(routine, tplExId);
      if (!target) return { kind: 'unsupported' };
      const day = nextDays.find((d) => d.id === target.dayId);
      if (!day) return { kind: 'unsupported' };
      const ex = day.exercises.find((e) => e.exerciseId === target.exerciseId);
      if (!ex) return { kind: 'unsupported' };
      // Delta is conventional — "more sets" suggests +1, "fewer" -1. The owner
      // picks the final number; this is the smallest unambiguous read.
      const cur = ex.plannedSets ?? ESTIMATED_SETS_FALLBACK;
      const next = sticker === 'more_sets' ? cur + 1 : Math.max(0, cur - 1);
      if (next === cur) return { kind: 'no-change' };
      ex.plannedSets = next;
      break;
    }
    case 'custom_exercise': {
      // The reviewer proposed a brand-new exercise. We have its muscle
      // breakdown in the payload — register it in the lookup under a synthetic
      // id and add it to the target day. If no day was selected, treat as a
      // routine-level suggestion (added at the end of the first day with
      // capacity) — that matches the apply behaviour on the owner side.
      const dayId = suggestion.targetId;
      if (!dayId) return { kind: 'unsupported' };
      const primary = arrStr(payload.primaryMuscles) ?? [];
      const secondary = arrStr(payload.secondaryMuscles) ?? [];
      if (primary.length === 0 && secondary.length === 0) return { kind: 'unsupported' };
      const day = nextDays.find((d) => d.id === dayId);
      if (!day) return { kind: 'unsupported' };
      const syntheticId = `__suggestion_custom_${suggestion.targetId}`;
      const lookupWithCustom = new Map(exerciseLookup);
      lookupWithCustom.set(syntheticId, { primaryMuscles: primary, secondaryMuscles: secondary });
      day.exercises.push({ exerciseId: syntheticId, plannedSets: null });
      return finalize(nextDays, lookupWithCustom, muscleGroups, baseTotals);
    }
    case 'holistic_add':
    case 'holistic_remove':
      return { kind: 'variable' };
    default:
      return { kind: 'unsupported' };
  }

  return finalize(nextDays, exerciseLookup, muscleGroups, baseTotals);
}

type PlannedDay = {
  id: string;
  exercises: { exerciseId: string; plannedSets: number | null; poolId?: string | null }[];
  pools?: { id: string; pickCount: number }[];
};

function finalize(
  nextDays: PlannedDay[],
  exerciseLookup: Map<string, ExerciseMuscleShape>,
  muscleGroups: ShareMuscleGroup[],
  baseTotals: MuscleVolumes,
): SuggestionDiffResult {
  const { totals: nextTotals } = computeRoutineVolumes(nextDays, exerciseLookup);
  const byId = new Map(muscleGroups.map((m) => [m.id, m]));
  const deltas: SuggestionDelta[] = [];

  // Iterate the union of muscle ids in both maps so we catch additions and
  // removals symmetrically.
  const allIds = new Set<string>([...baseTotals.keys(), ...nextTotals.keys()]);
  for (const id of allIds) {
    const before = baseTotals.get(id)?.sets ?? 0;
    const after = nextTotals.get(id)?.sets ?? 0;
    if (round1(before) === round1(after)) continue;
    const m = byId.get(id);
    if (!m) continue;
    deltas.push({
      muscleId: id,
      label: m.label,
      before,
      after,
      tierBefore: tierOf(before, m),
      tierAfter: tierOf(after, m),
    });
  }

  if (deltas.length === 0) return { kind: 'no-change' };
  // Sort by absolute change so the biggest swings lead. Stable on ties.
  deltas.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  return { kind: 'deterministic', deltas };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function arrStr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function findByTemplateExerciseId(
  routine: RoutineForShare,
  templateExerciseId: string,
): { dayId: string; exerciseId: string } | null {
  for (const d of routine.days) {
    for (const ex of d.exercises) {
      if (ex.templateExerciseId === templateExerciseId) {
        return { dayId: d.id, exerciseId: ex.exerciseId };
      }
    }
  }
  return null;
}

// ============================================================
// DIFF DISPLAY
// ============================================================

export function SuggestionDiffStrip({ result }: { result: SuggestionDiffResult }) {
  if (result.kind === 'no-change' || result.kind === 'unsupported') return null;
  if (result.kind === 'variable') {
    return (
      <div className="text-[10px] italic text-ink-500 mt-1">
        Coverage impact: varies depending on which option the owner picks.
      </div>
    );
  }
  // Cap at the 5 biggest moves so a holistic-style suggestion doesn't expand
  // into a wall. The summary itself communicates "this is what changed",
  // not a balance sheet.
  const top = result.deltas.slice(0, 5);
  const more = result.deltas.length - top.length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span
        className="text-[9px] tracking-[0.2em] uppercase text-ink-600"
        title="Coverage delta if the owner accepts this suggestion."
      >
        Coverage
      </span>
      {top.map((d) => {
        const dir = d.after > d.before ? '↑' : '↓';
        const tok = TIER_VISUALS[d.tierAfter];
        return (
          <span
            key={d.muscleId}
            className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border"
            style={{ background: tok.bg, borderColor: tok.border }}
            title={`${d.label}: ${formatSets(d.before)} → ${formatSets(d.after)} sets · tier now ${tok.label}`}
          >
            <span className="w-1 h-1 rounded-full" style={{ background: tok.dot }} />
            <span className="text-ink-200">{d.label}</span>
            <span className="text-ink-500">
              {formatSets(d.before)}
              {dir}
              {formatSets(d.after)}
            </span>
          </span>
        );
      })}
      {more > 0 && <span className="text-[10px] text-ink-600">+{more} more</span>}
    </div>
  );
}
