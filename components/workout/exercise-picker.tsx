'use client';

// Exercise picker — bottom sheet on mobile, centered modal on desktop.
//
// Two tabs: Browse + Add custom.
//
// The Browse tab is multi-select with area chips at the top (regions on the
// first row, muscle groups on the second). Tapping chips filters the visible
// exercise list; tapping rows toggles selection. A sticky footer shows a
// target summary, an optional soft balance hint, and a single "Add N"
// commit button.
//
// The Add custom tab is unchanged from before.
//
// The shape this component receives mirrors what workout-view passes —
// exercises with primary/secondary muscles, plus an excludeIds set for
// already-in-session items. Initial chip selection comes from the empty
// state's area chips (when the picker is opened from there) so the user's
// pre-filter carries through; otherwise it starts unfiltered.

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Trash2, PlayCircle, Check } from 'lucide-react';
import {
  EXERCISE_MODULES,
  MUSCLE_GROUPS,
  MuscleGroup,
  moduleDescription,
} from '@/lib/exercises-data';
import {
  REGIONS,
  MUSCLE_CHIPS,
  matchesArea,
  summariseTargets,
  balanceHint,
} from '@/lib/area-filter';
import type { ExerciseInfo } from './workout-view';
import { usePrefs } from '@/components/ui/prefs-context';
import {
  TIME_ESTIMATE,
  estimatePlannedExerciseSeconds,
  workTimePerSet,
  formatEstimate,
  formatEstimateCompact,
} from '@/lib/time-estimate';

type Props = {
  availableExercises: ExerciseInfo[];
  excludeIds: Set<string>;
  // Initial chip selection — used when the picker is opened from the empty
  // state with chips already selected. Optional; defaults to no filter.
  initialRegionIds?: string[];
  initialMuscleChipIds?: string[];
  // Optional: muscle ids the *containing surface* considers undercovered. The
  // picker doesn't compute this — the routine editor passes it through so
  // exercises whose primary muscles include any of these surface a "fills a
  // gap" hint. Empty/undefined = no gap signal (use everywhere this prop is
  // unset, e.g. mid-session adds).
  gapMuscles?: Set<string>;
  onPickMany: (exerciseIds: string[]) => void;
  onClose: () => void;
  onCreateCustom: (
    name: string,
    primaryMuscles: string[],
    secondaryMuscles: string[],
    prescription: string | undefined,
    videoUrl: string | undefined,
    restTimerSeconds: number | undefined,
  ) => void;
  onDeleteCustom: (exerciseId: string) => void;
  // When set, the picker is in swap mode: single-select with instant commit,
  // a different title, and the "Add custom" tab is hidden (creating a new
  // exercise mid-swap is the wrong workflow). The chip filter is still live
  // so the user can widen the search if the pre-filter is too narrow.
  swap?: {
    targetName: string;
    onPick: (newExerciseId: string) => void;
  };
};

export function ExercisePicker({
  availableExercises,
  excludeIds,
  initialRegionIds = [],
  initialMuscleChipIds = [],
  gapMuscles,
  onPickMany,
  onClose,
  onCreateCustom,
  onDeleteCustom,
  swap,
}: Props) {
  const [tab, setTab] = useState<'browse' | 'custom'>('browse');
  const isSwap = swap !== undefined;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
    >
      <div
        className="bg-ink-950 border border-ink-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-ink-800 flex items-center justify-between">
          <h2 id="picker-title" className="font-display text-2xl">
            {isSwap ? (
              <>
                Replace{' '}
                <span className="accent-text">{swap.targetName}</span>
              </>
            ) : (
              'Pick exercises'
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-100 transition p-2 -mr-2"
            aria-label="Close picker"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs are only meaningful in add mode. During a swap the user is
            replacing a known slot; creating a brand-new custom mid-swap is a
            workflow we deliberately don't support — finish the swap first. */}
        {!isSwap && (
          <div className="flex border-b border-ink-800 px-5">
            <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>
              Browse
            </TabButton>
            <TabButton active={tab === 'custom'} onClick={() => setTab('custom')}>
              Add custom
            </TabButton>
          </div>
        )}

        {isSwap || tab === 'browse' ? (
          <BrowseTab
            availableExercises={availableExercises}
            excludeIds={excludeIds}
            initialRegionIds={initialRegionIds}
            initialMuscleChipIds={initialMuscleChipIds}
            gapMuscles={gapMuscles}
            onPickMany={(ids) => {
              onPickMany(ids);
              // Picker closes on successful add — workout-view's onPickMany
              // wraps the action in a transition; we close optimistically
              // because the picker's job is done.
              onClose();
            }}
            onDeleteCustom={onDeleteCustom}
            swapMode={
              swap
                ? {
                    onPick: (id) => {
                      swap.onPick(id);
                      onClose();
                    },
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <CustomTab
              onCreate={(name, primary, secondary, prescription, videoUrl, restTimerSeconds) => {
                onCreateCustom(name, primary, secondary, prescription, videoUrl, restTimerSeconds);
                setTab('browse');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`py-3 px-4 text-xs tracking-[0.2em] uppercase transition ${
        active ? 'accent-text border-b-2 accent-border' : 'text-ink-500 hover:text-ink-300'
      }`}
    >
      {children}
    </button>
  );
}

// ============ BROWSE TAB (chip filter + multi-select) ============

function BrowseTab({
  availableExercises,
  excludeIds,
  initialRegionIds,
  initialMuscleChipIds,
  gapMuscles,
  onPickMany,
  onDeleteCustom,
  swapMode,
}: {
  availableExercises: ExerciseInfo[];
  excludeIds: Set<string>;
  initialRegionIds: string[];
  initialMuscleChipIds: string[];
  gapMuscles?: Set<string>;
  onPickMany: (ids: string[]) => void;
  onDeleteCustom: (id: string) => void;
  // When set, tapping any row commits immediately and the parent closes the
  // picker. The footer + checkbox-multi-select UI is hidden in this mode.
  swapMode?: { onPick: (id: string) => void };
}) {
  const isSwap = swapMode !== undefined;
  const [query, setQuery] = useState('');
  const [regionIds, setRegionIds] = useState<string[]>(initialRegionIds);
  const [muscleChipIds, setMuscleChipIds] = useState<string[]>(initialMuscleChipIds);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "Show only gap-filling exercises" toggle. Only meaningful when the parent
  // surface actually has a gap signal — collapsed otherwise.
  const [gapsOnly, setGapsOnly] = useState(false);
  const hasGapSignal = gapMuscles !== undefined && gapMuscles.size > 0;
  const { prefs } = usePrefs();

  function toggleRegion(id: string) {
    setRegionIds((prev) => {
      if (id === 'full') {
        // Full body is exclusive — clears every other chip and toggles itself.
        return prev.includes('full') ? [] : ['full'];
      }
      const without = prev.filter((r) => r !== 'full');
      return without.includes(id) ? without.filter((r) => r !== id) : [...without, id];
    });
  }
  function toggleMuscle(id: string) {
    setMuscleChipIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
    // Picking a muscle chip implicitly cancels Full body (which means "no filter")
    setRegionIds((prev) => prev.filter((r) => r !== 'full'));
  }
  function clearChips() {
    setRegionIds([]);
    setMuscleChipIds([]);
  }

  // Per-exercise gap derivation. An exercise "fills a gap" when one of its
  // *primary* muscles is in the gap set — secondary credit is too diffuse to
  // hang a recommendation on. Map keyed by exercise id, value is the list of
  // gap-muscle ids it hits (preserves the source order so the chip text
  // reads naturally).
  const gapHitsById = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!gapMuscles || gapMuscles.size === 0) return out;
    for (const e of availableExercises) {
      const hits = e.primaryMuscles.filter((m) => gapMuscles.has(m));
      if (hits.length > 0) out.set(e.id, hits);
    }
    return out;
  }, [availableExercises, gapMuscles]);

  const groupedByModule = useMemo(() => {
    const filtered = availableExercises.filter((e) => {
      if (excludeIds.has(e.id)) return false;
      if (gapsOnly && hasGapSignal && !gapHitsById.has(e.id)) return false;
      if (!matchesArea(e, regionIds, muscleChipIds)) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        e.primaryMuscles.some((m) => m.toLowerCase().includes(q)) ||
        e.secondaryMuscles.some((m) => m.toLowerCase().includes(q))
      );
    });
    const groups = new Map<string, ExerciseInfo[]>();
    for (const ex of filtered) {
      if (!groups.has(ex.module)) groups.set(ex.module, []);
      groups.get(ex.module)!.push(ex);
    }
    // Within each module, sort by first primary muscle, then by name. This
    // keeps like-exercises adjacent in the list so a user (or a reviewer
    // browsing for a swap candidate) doesn't have to scroll past dissimilar
    // movements to find the next "same-muscle" option. Modules with no
    // primary-muscle metadata fall back to plain name order.
    for (const [, arr] of groups) {
      arr.sort((a, b) => {
        const am = a.primaryMuscles[0] ?? '';
        const bm = b.primaryMuscles[0] ?? '';
        if (am !== bm) return am.localeCompare(bm);
        return a.name.localeCompare(b.name);
      });
    }
    return groups;
  }, [
    availableExercises,
    excludeIds,
    regionIds,
    muscleChipIds,
    query,
    gapsOnly,
    hasGapSignal,
    gapHitsById,
  ]);

  // Order derives from EXERCISE_MODULES (the natural session flow) with 'Custom'
  // appended so user-created exercises sort last. Single source of truth — if
  // EXERCISE_MODULES is reordered, the picker follows.
  const moduleOrder = [...EXERCISE_MODULES, 'Custom'];
  const orderedModules = moduleOrder.filter((m) => groupedByModule.has(m));
  const totalCount = Array.from(groupedByModule.values()).reduce((s, arr) => s + arr.length, 0);

  const selectedExercises = useMemo(
    () => availableExercises.filter((e) => selected.has(e.id)),
    [availableExercises, selected],
  );
  const summary = useMemo(() => summariseTargets(selectedExercises), [selectedExercises]);
  const hint = useMemo(() => balanceHint(selectedExercises), [selectedExercises]);

  // Per-exercise time estimate at default planning. Shown on every row so the
  // user can see how each pick compounds before committing — and the building
  // blocks (work-per-set × set count) are visible too, so the number isn't a
  // black-box guess. No template is involved, so plannedSets/Reps/Seconds are
  // null and the estimator falls back to its defaults.
  const estimateForExercise = (e: ExerciseInfo) => {
    const restSeconds = e.restTimerSecondsOverride ?? prefs.restTimerSeconds;
    const work = workTimePerSet({
      metric: e.metric,
      plannedReps: null,
      plannedSeconds: null,
    });
    const total = estimatePlannedExerciseSeconds({
      metric: e.metric,
      plannedSets: null,
      plannedReps: null,
      plannedSeconds: null,
      restSeconds,
    });
    return { work, total, sets: TIME_ESTIMATE.DEFAULT_SETS };
  };

  const selectedTotalSec = useMemo(
    () =>
      selectedExercises.reduce(
        (sum, e) => sum + estimateForExercise(e).total,
        0,
      ),
    // estimateForExercise depends on prefs; selected set already triggers via selectedExercises.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedExercises, prefs.restTimerSeconds],
  );

  function toggleSelection(id: string) {
    if (swapMode) {
      // Single-select with instant commit. Parent closes the picker.
      swapMode.onPick(id);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commit() {
    if (selected.size === 0) return;
    // Preserve the order in which the user selected — Set preserves insertion
    // order, which is what we want.
    onPickMany(Array.from(selected));
  }

  const anyChipsSelected = regionIds.length > 0 || muscleChipIds.length > 0;

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-3 pb-2 sticky top-0 bg-ink-950 z-10 border-b border-ink-900">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {REGIONS.map((r) => (
              <ChipButton
                key={r.id}
                active={regionIds.includes(r.id)}
                onClick={() => toggleRegion(r.id)}
              >
                {r.label}
              </ChipButton>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {MUSCLE_CHIPS.map((m) => (
              <ChipButton
                key={m.id}
                active={muscleChipIds.includes(m.id)}
                onClick={() => toggleMuscle(m.id)}
                variant="muscle"
              >
                {m.label}
              </ChipButton>
            ))}
            {anyChipsSelected && (
              <button
                onClick={clearChips}
                className="text-[11px] text-ink-500 hover:text-ink-200 transition px-2 py-1.5"
              >
                Clear
              </button>
            )}
          </div>
          {hasGapSignal && (
            <GapToggle
              active={gapsOnly}
              gapCount={gapMuscles!.size}
              onClick={() => setGapsOnly((v) => !v)}
            />
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises or muscles..."
              className="w-full bg-ink-900 border border-ink-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>

        <div className="px-5 py-3">
          {totalCount === 0 ? (
            <div className="text-center py-10 text-sm text-ink-500 italic font-display">
              No exercises match.
            </div>
          ) : (
            orderedModules.map((module) => {
              const exercises = groupedByModule.get(module)!;
              const description = moduleDescription(module);
              // Module-level multi-select: count what's already selected so
              // the action label flips between "Add all" (some/none selected)
              // and "Clear" (all selected). Skips swap mode entirely — that
              // surface is single-select, the helper would be confusing.
              const selectedInModule = exercises.filter((e) => selected.has(e.id)).length;
              const allSelected = selectedInModule === exercises.length;
              function toggleAllInModule() {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (allSelected) {
                    for (const ex of exercises) next.delete(ex.id);
                  } else {
                    for (const ex of exercises) next.add(ex.id);
                  }
                  return next;
                });
              }
              return (
                <div key={module} className="mb-5">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
                        {module}
                      </div>
                      {description && (
                        <div className="text-[10px] text-ink-600 italic font-display leading-snug mt-0.5">
                          {description}
                        </div>
                      )}
                    </div>
                    {!isSwap && exercises.length > 1 && (
                      <button
                        type="button"
                        onClick={toggleAllInModule}
                        className="text-[10px] tracking-wider uppercase shrink-0 px-2 py-1 rounded-full border border-ink-800 hover:border-accent/50 text-ink-400 hover:text-ink-100 transition"
                        title={
                          allSelected
                            ? `Clear all ${exercises.length} ${module} exercises from the selection`
                            : `Add all ${exercises.length} ${module} exercises to the selection`
                        }
                      >
                        {allSelected ? `Clear ${exercises.length}` : `Add all ${exercises.length}`}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {exercises.map((ex) => {
                      const isSelected = selected.has(ex.id);
                      const gapHits = gapHitsById.get(ex.id);
                      const fillsGap = !isSelected && gapHits !== undefined;
                      // Highlight is intentionally quiet: a left-edge accent
                      // stripe (like a bookmark) + the chip badge below. The
                      // row's other three borders stay ink so unselected
                      // gap-fillers don't shout next to the muscle chip row
                      // above them. Selected wins visually with the full
                      // accent border.
                      const baseBorder = 'border border-ink-800';
                      const rowClass = isSelected
                        ? 'border accent-border bg-accent/5'
                        : fillsGap
                          ? `${baseBorder} border-l-2 border-l-accent/60 hover:border-accent/40`
                          : `${baseBorder} hover:border-accent/40`;
                      return (
                        <div
                          key={ex.id}
                          className={`transition rounded-lg flex items-stretch ${rowClass}`}
                        >
                          <button
                            onClick={() => toggleSelection(ex.id)}
                            className="flex-1 px-3 py-2.5 text-left flex items-center gap-3"
                          >
                            {/* Checkbox is multi-select scaffolding; in swap
                                mode the row commits on tap so we drop it. */}
                            {!isSwap && (
                              <span
                                className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition ${
                                  isSelected
                                    ? 'accent-bg accent-border'
                                    : 'border-ink-700'
                                }`}
                                aria-hidden="true"
                              >
                                {isSelected && (
                                  <Check size={13} strokeWidth={3} className="text-ink-950" />
                                )}
                              </span>
                            )}
                            <span className="flex-1 min-w-0">
                              <span className="text-sm text-ink-100 flex items-center gap-1.5">
                                <span className="truncate">{ex.name}</span>
                                {ex.videoUrl && (
                                  <PlayCircle
                                    size={11}
                                    className="text-ink-500 shrink-0"
                                    aria-label="Has demo video"
                                  />
                                )}
                              </span>
                              <span className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {ex.prescription && (
                                  <span className="text-[10px] text-ink-500 font-mono">
                                    {ex.prescription}
                                  </span>
                                )}
                                {(() => {
                                  const est = estimateForExercise(ex);
                                  return (
                                    <span
                                      className="text-[10px] text-ink-500 font-mono"
                                      title={`${formatEstimateCompact(est.work)} per set × ${est.sets} sets at default planning`}
                                    >
                                      ~{formatEstimateCompact(est.total)}
                                      <span className="text-ink-700">
                                        {' '}
                                        ({formatEstimateCompact(est.work)}×{est.sets})
                                      </span>
                                    </span>
                                  );
                                })()}
                                {ex.primaryMuscles.length > 0 && (
                                  <span className="text-[10px] text-ink-500">
                                    · {ex.primaryMuscles.slice(0, 3).join(', ')}
                                    {ex.primaryMuscles.length > 3 ? '…' : ''}
                                  </span>
                                )}
                                {fillsGap && (
                                  <GapBadge muscleIds={gapHits!} />
                                )}
                              </span>
                            </span>
                          </button>
                          {ex.isCustom && (
                            <button
                              onClick={() => onDeleteCustom(ex.id)}
                              className="px-4 text-ink-500 hover:text-bad transition border-l border-ink-800"
                              aria-label={`Delete custom exercise ${ex.name}`}
                              title="Delete custom exercise"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* In swap mode the row IS the commit, so the bottom-bar selection
          summary + commit button has nothing to do — drop it entirely. */}
      {!isSwap && (
        <PickerFooter
          selectedCount={selected.size}
          primaryCounts={summary.primaryCounts}
          hint={hint}
          totalSec={selectedTotalSec}
          onCommit={commit}
        />
      )}
    </>
  );
}

// Small text-only chip that names the muscle gaps an exercise would help
// close. The whole gap signal hangs on this label and a left-edge stripe on
// the row — there's no tinted background or border so the surrounding chip
// filters and search field still hold the eye. Caps at two muscles + an
// overflow indicator.
function GapBadge({ muscleIds }: { muscleIds: string[] }) {
  const labels = muscleIds.map(
    (id) => MUSCLE_GROUPS.find((m: MuscleGroup) => m.id === id)?.label ?? id,
  );
  const visible = labels.slice(0, 2);
  const extra = labels.length - visible.length;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] accent-text leading-none"
      title={
        labels.length > 0
          ? `Fills coverage gap: ${labels.join(', ')}`
          : 'Fills a coverage gap'
      }
    >
      <span aria-hidden="true">↗</span>
      <span>fills {visible.join(', ')}</span>
      {extra > 0 && <span className="text-ink-500">+{extra}</span>}
    </span>
  );
}

// Filter-only toggle. The highlight on gap-filling rows is always on; this
// just hides exercises that don't close a current gap so the user can browse
// only the ones that would. Sized like a chip rather than a banner so it sits
// among the existing chip filters without out-shouting them.
function GapToggle({
  active,
  gapCount,
  onClick,
}: {
  active: boolean;
  gapCount: number;
  onClick: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[10px] text-ink-500 italic font-display leading-tight">
        {gapCount} muscle{gapCount === 1 ? '' : 's'} short of target — exercises
        that fill those are flagged below.
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`shrink-0 text-[10px] inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition ${
          active
            ? 'accent-bg text-ink-950 border-transparent'
            : 'border-ink-700 text-ink-400 hover:border-accent/50 hover:accent-text'
        }`}
      >
        {active ? (
          <>
            <Check size={10} strokeWidth={3} aria-hidden="true" />
            <span>only gaps</span>
          </>
        ) : (
          <span>hide non-gaps</span>
        )}
      </button>
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
  variant = 'region',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'region' | 'muscle';
}) {
  const activeClass =
    variant === 'region'
      ? 'accent-bg text-ink-950 border-transparent'
      : 'bg-ink-200 text-ink-950 border-transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition ${
        active ? activeClass : 'border-ink-800 text-ink-300 hover:border-ink-600'
      }`}
    >
      {children}
    </button>
  );
}

// ============ FOOTER (target summary + hint + commit) ============

function PickerFooter({
  selectedCount,
  primaryCounts,
  hint,
  totalSec,
  onCommit,
}: {
  selectedCount: number;
  primaryCounts: Map<string, number>;
  hint: string | null;
  // Sum of per-exercise estimates for the current selection. Shown alongside
  // the target summary so the user can see "+3 exercises and ~7 min" at a
  // glance before committing.
  totalSec: number;
  onCommit: () => void;
}) {
  // Convert the primary-count map into labelled rows. Order by descending
  // count so the dominant muscle reads first.
  const rows = Array.from(primaryCounts.entries())
    .map(([id, count]) => ({
      id,
      label:
        MUSCLE_GROUPS.find((m: MuscleGroup) => m.id === id)?.label ?? id,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="border-t border-ink-800 bg-ink-950 px-5 py-3 space-y-2">
      {selectedCount > 0 && rows.length > 0 && (
        <div className="text-[11px] text-ink-400 leading-relaxed">
          <span className="text-ink-500 mr-1">Targets:</span>
          {rows.map((r, idx) => (
            <span key={r.id}>
              {idx > 0 && <span className="text-ink-700"> · </span>}
              <span className="text-ink-200">{r.label}</span>{' '}
              <span className="text-ink-500">{'•'.repeat(r.count)}</span>
            </span>
          ))}
        </div>
      )}
      {hint && (
        <div className="text-[11px] text-ink-300 italic font-display border-l-2 border-ink-700 pl-2">
          {hint}
        </div>
      )}
      <button
        onClick={onCommit}
        disabled={selectedCount === 0}
        className="w-full accent-bg text-ink-950 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {selectedCount === 0
          ? 'Pick exercises to add'
          : `Add ${selectedCount} to session · +~${formatEstimate(totalSec)}`}
      </button>
    </div>
  );
}

// ============ CUSTOM TAB ============

function CustomTab({
  onCreate,
}: {
  onCreate: (
    name: string,
    primaryMuscles: string[],
    secondaryMuscles: string[],
    prescription: string | undefined,
    videoUrl: string | undefined,
    restTimerSeconds: number | undefined,
  ) => void;
}) {
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<string[]>([]);
  const [prescription, setPrescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [restSeconds, setRestSeconds] = useState<number | null>(null);

  function togglePrimary(id: string) {
    setPrimary((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setSecondary((s) => s.filter((x) => x !== id));
  }
  function toggleSecondary(id: string) {
    setSecondary((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setPrimary((p) => p.filter((x) => x !== id));
  }

  function validateUrl(url: string): string | null {
    if (!url.trim()) return null;
    try {
      new URL(url);
      return null;
    } catch {
      return 'Must be a full URL (https://…)';
    }
  }

  function submit() {
    if (!name.trim() || primary.length === 0) return;
    const trimmedUrl = videoUrl.trim();
    const urlError = validateUrl(trimmedUrl);
    if (urlError) {
      setVideoError(urlError);
      return;
    }
    onCreate(
      name.trim(),
      primary,
      secondary,
      prescription.trim() || undefined,
      trimmedUrl || undefined,
      restSeconds ?? undefined,
    );
    setName('');
    setPrimary([]);
    setSecondary([]);
    setPrescription('');
    setVideoUrl('');
    setVideoError(null);
    setRestSeconds(null);
  }

  const canSubmit = name.trim().length > 0 && primary.length > 0;

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-ink-500 italic font-display mb-4">
        Add anything that&apos;s not in the built-in list.
      </p>

      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Bench press"
        className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-accent/50"
      />

      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Default scheme <span className="text-ink-600">(optional)</span>
      </label>
      <input
        type="text"
        value={prescription}
        onChange={(e) => setPrescription(e.target.value)}
        placeholder="e.g. 4×8"
        className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-accent/50"
      />

      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Demo video URL <span className="text-ink-600">(optional)</span>
      </label>
      <input
        type="url"
        value={videoUrl}
        onChange={(e) => {
          setVideoUrl(e.target.value);
          if (videoError) setVideoError(null);
        }}
        placeholder="https://youtube.com/watch?v=…"
        className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:border-accent/50"
      />
      {videoError ? (
        <p className="text-[10px] text-bad mb-3">{videoError}</p>
      ) : (
        <div className="mb-4" />
      )}

      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Primary muscles <span className="accent-text">*</span>
      </label>
      <p className="text-[10px] text-ink-500 italic font-display mb-2">
        What this exercise is built around. Each set counts fully toward these.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MUSCLE_GROUPS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => togglePrimary(m.id)}
            className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
              primary.includes(m.id)
                ? 'accent-bg text-ink-950 border-transparent'
                : 'border-ink-800 text-ink-300 hover:border-ink-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Secondary muscles <span className="text-ink-600">(optional)</span>
      </label>
      <p className="text-[10px] text-ink-500 italic font-display mb-2">
        Worked but not the focus. Each set counts as half.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {MUSCLE_GROUPS.map((m) => {
          const isPrimary = primary.includes(m.id);
          const isSecondary = secondary.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleSecondary(m.id)}
              disabled={isPrimary}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                isSecondary
                  ? 'bg-ink-300 text-ink-950 border-transparent'
                  : isPrimary
                    ? 'border-ink-900 text-ink-700 cursor-not-allowed'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600'
              }`}
              title={isPrimary ? 'Already a primary muscle' : undefined}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Default rest <span className="text-ink-600">(optional)</span>
      </label>
      <p className="text-[10px] text-ink-500 italic font-display mb-2">
        Tap a duration to override just for this exercise. Leave blank to use your global setting.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          type="button"
          onClick={() => setRestSeconds(null)}
          className={`text-xs px-2.5 py-1 rounded-full border transition ${
            restSeconds === null
              ? 'accent-bg text-ink-950 border-transparent'
              : 'border-ink-800 text-ink-300 hover:border-ink-600'
          }`}
        >
          Use global
        </button>
        {[30, 60, 90, 120, 180, 240].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setRestSeconds(s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              restSeconds === s
                ? 'accent-bg text-ink-950 border-transparent'
                : 'border-ink-800 text-ink-300 hover:border-ink-600'
            }`}
          >
            {s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}m` : `${(s / 60).toFixed(1)}m`}
          </button>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full accent-bg text-ink-950 py-3 rounded-lg font-semibold tracking-wide disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition"
      >
        Add to my list
      </button>
    </div>
  );
}
