'use client';

// RoutineEditor — single editor for the user's routine.
//
// Two modes, one component tree:
//
//   - DraftEditor (no routine yet): everything lives in local state. Build
//     the schedule, all the days, and per-day exercise lineups before
//     anything is persisted. A single Save button at the bottom commits the
//     whole thing via createRoutineFromDraft. Bailing out (closing the tab,
//     navigating away) loses the draft cleanly because nothing was ever
//     written. This matches the user's expectation that the *creation* of a
//     routine is intentional — incremental committing should not happen.
//
//   - LiveEditor (routine exists): every change persists immediately through
//     a server action. No save buttons; no confirmation popups. Schedule
//     toggle flips in place; an always-visible hint warns about losing
//     weekday pins on switch. Name and description commit on blur.
//
// DayCard is shared between modes: it takes a slim day shape and a bag of
// callbacks. In Draft mode the callbacks update local state; in Live mode
// they call server actions. The card itself doesn't know the difference.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownAZ,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  Replace,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  addExerciseToRoutineDay,
  addRoutineDay,
  createCustomExercise,
  createRoutineFromDraft,
  deleteCustomExercise,
  deleteRoutine,
  duplicateRoutineDay,
  removeExerciseFromRoutineDay,
  removeRoutineDay,
  reorderRoutineDay,
  swapRoutineDayPositions,
  reorderRoutineDayExercise,
  setRoutineDayExerciseOrder,
  swapInRoutineTemplate,
  updateRoutine,
  updateRoutineDay,
  updateRoutineDayExercise,
} from '@/lib/actions';
import {
  MAX_ROUTINE_DAYS,
  WEEKDAY_FULL_LABELS,
  WEEKDAY_LABELS,
  type ScheduleStyle,
} from '@/lib/routine';
import { EXERCISE_MODULES } from '@/lib/exercises-data';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { ModuleInfoTooltip } from '@/components/ui/module-info-tooltip';
import {
  ExplainModuleSequence,
  ExplainScheduleStyle,
  ExplainDayDescription,
} from '@/lib/explanations';
import {
  ESTIMATED_SETS_FALLBACK,
  TIER_VISUALS,
  computeDayVolumes,
  computeRoutineVolumes,
  formatSets,
  tierFor as coverageTierFor,
  type CoverageTier,
  type MuscleVolume,
  type MuscleVolumes,
} from '@/lib/coverage';
import {
  buildStarterRoutine,
  EQUIPMENT_GROUPS,
  EQUIPMENT_LABELS,
  EQUIPMENT_TIERS,
  EQUIPMENT_TIER_INFO,
  STARTER_DURATIONS,
  STARTER_FOCUS_INFO,
  TIER_EQUIPMENT,
  type EquipmentTier,
  type StarterDuration,
  type StarterFocus,
} from '@/lib/starter-routines';
import { ExercisePicker } from '@/components/workout/exercise-picker';
import type { ExerciseInfo } from '@/components/workout/workout-view';
import { useConfirm } from '@/components/ui/use-confirm';
import { usePrefs } from '@/components/ui/prefs-context';
import { estimatePlannedExerciseSeconds, formatEstimateCompact } from '@/lib/time-estimate';
import { VideoLink } from '@/components/ui/video-link';
import { EquipmentChips } from '@/components/ui/equipment-chips';
import { regionForExercise, REGION_STYLES } from '@/lib/region-color';

// ============ TYPES ============

// Slim shape used by DayCard. Live mode synthesizes this from the server
// data; Draft mode synthesizes it from local state.
type DayExercise = {
  exerciseId: string;
  name: string;
  module: string;
  metric: string;
  plannedSets: number | null;
  plannedReps: number | null;
  plannedSeconds: number | null;
  note: string | null;
  videoUrl: string | null;
  equipment: string[];
  // First primary muscle drives the region-color accent on the row. Cheaper
  // than threading a Map<id, ExerciseInfo> down to ExerciseRow.
  primaryMuscles: string[];
};

type EditorDay = {
  id: string;
  name: string;
  label: string | null;
  description: string | null;
  weekday: number | null;
  exercises: DayExercise[];
};

// Module → canonical rank (smaller = earlier in a session). Unknown / custom
// modules fall through to the end, in first-appearance order.
const MODULE_ORDER_MAP = new Map<string, number>(EXERCISE_MODULES.map((m, i) => [m, i] as const));
const UNKNOWN_MODULE_RANK = EXERCISE_MODULES.length;
function moduleRank(m: string): number {
  return MODULE_ORDER_MAP.get(m) ?? UNKNOWN_MODULE_RANK;
}

type ModuleGroup<T extends { module: string }> = { module: string; exercises: T[] };

// Group day exercises by module in canonical session order. Within each group
// the original sequence is preserved — for a day whose exercises array is
// position-sorted, that means user intent within a module is kept intact.
// Modules with no exercises are not emitted.
function groupExercisesByModule<T extends { module: string }>(exercises: T[]): ModuleGroup<T>[] {
  const byModule = new Map<string, T[]>();
  for (const ex of exercises) {
    let bucket = byModule.get(ex.module);
    if (!bucket) {
      bucket = [];
      byModule.set(ex.module, bucket);
    }
    bucket.push(ex);
  }
  return Array.from(byModule.entries())
    .sort((a, b) => moduleRank(a[0]) - moduleRank(b[0]))
    .map(([module, exercises]) => ({ module, exercises }));
}

// Flatten the grouped view back to a flat list — the "sort by module" result.
function sortExercisesByModule<T extends { module: string }>(exercises: T[]): T[] {
  return groupExercisesByModule(exercises).flatMap((g) => g.exercises);
}

// Cheap "is the current order already canonical?" check so the Sort button
// can disable itself when there's nothing to do.
function isCanonicalModuleOrder<T extends { module: string }>(exercises: T[]): boolean {
  let lastRank = -1;
  for (const ex of exercises) {
    const r = moduleRank(ex.module);
    if (r < lastRank) return false;
    lastRank = r;
  }
  return true;
}

export type DayClient = {
  id: string;
  position: number;
  weekday: number | null;
  label: string | null;
  description: string | null;
  name: string;
  exercises: {
    templateExerciseId: string;
    exerciseId: string;
    name: string;
    module: string;
    metric: string;
    position: number;
    plannedSets: number | null;
    plannedReps: number | null;
    plannedSeconds: number | null;
    note: string | null;
    primaryMuscles: string[];
    secondaryMuscles: string[];
  }[];
};

export type RoutineClient = {
  id: string;
  name: string;
  description: string | null;
  scheduleStyle: ScheduleStyle;
  lastCompletedPosition: number | null;
  days: DayClient[];
};

export type SeedTemplateClient = {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  exerciseNames: string[];
};

export type MuscleGroupClient = {
  id: string;
  label: string;
  category: 'lower' | 'upper' | 'trunk' | 'mobility' | 'other';
  // Effective weekly volume target and minimum from the user's tier preset
  // combined with any per-muscle override. Both null for muscles tracked only
  // by recency (mobility/balance/cardio).
  min: number | null;
  target: number | null;
  isOverridden: boolean;
  // Plain-English description shown as a hover tooltip on the coverage row,
  // so the user can see what the muscle is and what hits it without leaving
  // the screen.
  description: string | null;
};

type Props = {
  routine: RoutineClient | null;
  seedTemplates: SeedTemplateClient[];
  availableExercises: ExerciseInfo[];
  muscleGroups: MuscleGroupClient[];
};

// ============ TOP-LEVEL DISPATCH ============

export function RoutineEditor({ routine, seedTemplates, availableExercises, muscleGroups }: Props) {
  return (
    <div className="px-5 pt-6 pb-24">
      <Header />
      {routine ? (
        <LiveEditor
          routine={routine}
          seedTemplates={seedTemplates}
          availableExercises={availableExercises}
          muscleGroups={muscleGroups}
        />
      ) : (
        <DraftEditor
          seedTemplates={seedTemplates}
          availableExercises={availableExercises}
          muscleGroups={muscleGroups}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6">
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">Plan</div>
      <h1
        className="font-display text-3xl tracking-tight"
        style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
      >
        Routine
      </h1>
      <p className="text-sm text-ink-400 italic font-display mt-1 leading-relaxed">
        Your cycle of templates &mdash; the structure you tell the app, not a plan it gives you.
      </p>
    </div>
  );
}

// ============ DRAFT EDITOR ============

type DraftExercise = {
  exerciseId: string;
  plannedSets: number | null;
  plannedReps: number | null;
  plannedSeconds: number | null;
  note: string | null;
};

type DraftDay = {
  // Stable client id for React keys and dispatch. Replaced with a server id
  // once the routine is saved (then the user enters Live mode).
  clientId: string;
  name: string;
  label: string | null;
  description: string | null;
  weekday: number | null;
  exercises: DraftExercise[];
};

function makeDraftDay(initial: Partial<DraftDay> = {}): DraftDay {
  return {
    clientId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    name: '',
    label: null,
    description: null,
    weekday: null,
    exercises: [],
    ...initial,
  };
}

// Local-storage key for the work-in-progress Custom draft. Single-user app,
// single browser per user — no userId namespace needed. Versioned so a future
// change to DraftDay shape can invalidate stale localStorage cleanly without
// trying to migrate.
const DRAFT_STORAGE_KEY = 'starter-routine-draft.v1';

// Separate key for the preset picker's filter state (focus tab, days,
// duration, equipment Set). Kept separate from the draft so the user's
// equipment toggles persist even after they save a routine and the draft
// is cleared.
const FILTERS_STORAGE_KEY = 'starter-routine-filters.v1';

type SerializedFilters = {
  presetTab?: string;
  presetDays?: number;
  presetDuration?: number;
  availableEquipment?: string[];
};

type PresetTab = StarterFocus | 'custom';

function DraftEditor({
  seedTemplates,
  availableExercises,
  muscleGroups,
}: {
  seedTemplates: SeedTemplateClient[];
  availableExercises: ExerciseInfo[];
  muscleGroups: MuscleGroupClient[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { prefs } = usePrefs();

  const [scheduleStyle, setScheduleStyle] = useState<ScheduleStyle>('sequence');
  const [days, setDays] = useState<DraftDay[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerForDayClientId, setPickerForDayClientId] = useState<string | null>(null);

  // Effective rest per exercise (override → global default), built once per
  // render. Surfaced to DayCard so per-day and per-module time estimates use
  // the same rest value the active session will. Single-user app — there's
  // no real risk of the map churning between renders.
  const restByExerciseId = useMemo(
    () =>
      new Map(
        availableExercises.map(
          (e) => [e.id, e.restTimerSecondsOverride ?? prefs.restTimerSeconds] as const,
        ),
      ),
    [availableExercises, prefs.restTimerSeconds],
  );

  // Preset picker state. The user lands on the Strength preview by default;
  // they pick filters and either click "Use this preset" (which copies the
  // built preset into `days` and switches to 'custom') or they switch to the
  // Custom tab to start blank / continue a WIP draft.
  //
  // `availableEquipment` is the picker's source of truth — the per-token Set
  // of gear the user has access to. The "Quick set" tier buttons in the UI
  // are convenience presets that snap this Set; users can also toggle
  // individual items, which un-snaps from any tier match.
  const [presetTab, setPresetTab] = useState<PresetTab>('strength');
  const [presetDays, setPresetDays] = useState<number>(3);
  const [presetDuration, setPresetDuration] = useState<StarterDuration>(45);
  const [availableEquipment, setAvailableEquipment] = useState<Set<string>>(
    () => new Set(TIER_EQUIPMENT['home-rack']),
  );
  // Set once we've attempted to hydrate from localStorage so the persistence
  // effects below don't write initial defaults over saved state.
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  // Hydrate the Custom draft from localStorage on mount. We only treat the
  // result as valid if every exercise still resolves — exercises can be
  // soft-deleted between sessions and a stale draft pointing at a missing
  // one would be a footgun. Drop unresolved entries silently; if the draft
  // is now empty, clear it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DraftDay[];
        if (Array.isArray(parsed)) {
          const validIds = new Set(availableExercises.map((e) => e.id));
          const cleaned = parsed
            .map((d) => ({
              ...d,
              exercises: (d.exercises ?? []).filter((e) => validIds.has(e.exerciseId)),
            }))
            .filter((d) => d.exercises.length > 0);
          setDays(cleaned);
        }
      }
    } catch {
      // Bad JSON or shape mismatch — start fresh, no need to surface it.
    }
    setDraftHydrated(true);
  }, [availableExercises]);

  // Persist Custom draft to localStorage on change. Skipped until hydration
  // completes so we never overwrite a saved draft with the initial empty
  // state during the first paint.
  useEffect(() => {
    if (!draftHydrated || typeof window === 'undefined') return;
    try {
      if (days.length === 0) {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(days));
      }
    } catch {
      // Storage full / blocked / private mode — UI continues to work without
      // persistence; no point yelling at the user.
    }
  }, [days, draftHydrated]);

  // Hydrate the preset filter state (tab, days, duration, equipment) from
  // localStorage on mount. Each field is independently optional — if any
  // are missing, we keep the default for that field.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SerializedFilters;
        if (
          parsed.presetTab === 'strength' ||
          parsed.presetTab === 'build' ||
          parsed.presetTab === 'mobility' ||
          parsed.presetTab === 'custom'
        ) {
          setPresetTab(parsed.presetTab);
        }
        if (
          typeof parsed.presetDays === 'number' &&
          parsed.presetDays >= 1 &&
          parsed.presetDays <= 7
        ) {
          setPresetDays(parsed.presetDays);
        }
        if (
          parsed.presetDuration === 15 ||
          parsed.presetDuration === 30 ||
          parsed.presetDuration === 45 ||
          parsed.presetDuration === 60
        ) {
          setPresetDuration(parsed.presetDuration);
        }
        if (Array.isArray(parsed.availableEquipment)) {
          setAvailableEquipment(
            new Set(parsed.availableEquipment.filter((s) => typeof s === 'string')),
          );
        }
      }
    } catch {
      // Treat any failure as "no saved filters" — defaults stand.
    }
    setFiltersHydrated(true);
  }, []);

  // Persist filters on change. Same hydration guard as the draft.
  useEffect(() => {
    if (!filtersHydrated || typeof window === 'undefined') return;
    try {
      const payload: SerializedFilters = {
        presetTab,
        presetDays,
        presetDuration,
        availableEquipment: Array.from(availableEquipment).sort(),
      };
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [presetTab, presetDays, presetDuration, availableEquipment, filtersHydrated]);

  const exerciseById = useMemo(
    () => new Map(availableExercises.map((e) => [e.id, e])),
    [availableExercises],
  );

  const seedTemplateById = useMemo(
    () => new Map(seedTemplates.map((t) => [t.id, t])),
    [seedTemplates],
  );

  // Project draft days into the shared DayCard shape.
  const editorDays: EditorDay[] = useMemo(
    () =>
      days.map((d, idx) => {
        const fallback = d.weekday !== null ? WEEKDAY_FULL_LABELS[d.weekday] : `Day ${idx + 1}`;
        return {
          id: d.clientId,
          name: d.name.trim() || fallback,
          label: d.label,
          description: d.description,
          weekday: d.weekday,
          exercises: d.exercises
            .map((dx) => {
              const e = exerciseById.get(dx.exerciseId);
              if (!e) return null;
              return {
                exerciseId: e.id,
                name: e.name,
                module: e.module,
                metric: e.metric,
                plannedSets: dx.plannedSets,
                plannedReps: dx.plannedReps,
                plannedSeconds: dx.plannedSeconds,
                note: dx.note,
                videoUrl: e.videoUrl,
                equipment: e.equipment,
                primaryMuscles: e.primaryMuscles,
              };
            })
            .filter((x): x is DayExercise => x !== null),
        };
      }),
    [days, exerciseById],
  );

  // Structural coverage totals — computed once per render. Drives both the
  // panel below the days and the gap-aware picker highlight: derive the set
  // of below-target muscles here so the picker can flag exercises that hit
  // them. Keeping the computation at the editor level (not inside the panel)
  // means the picker doesn't need to re-walk the day structure.
  const { totals, anyEstimated } = useMemo(
    () => computeMuscleTotals(editorDays, exerciseById),
    [editorDays, exerciseById],
  );
  const gapMuscles = useMemo(
    () => gapMusclesFromTotals(totals, muscleGroups),
    [totals, muscleGroups],
  );

  function updateDay(clientId: string, patch: (d: DraftDay) => DraftDay) {
    setDays((prev) => prev.map((d) => (d.clientId === clientId ? patch(d) : d)));
  }

  function addDay(weekday: number | null = null) {
    if (days.length >= MAX_ROUTINE_DAYS) return;
    setDays((prev) => [...prev, makeDraftDay({ weekday })]);
  }

  function removeDay(clientId: string) {
    setDays((prev) => prev.filter((d) => d.clientId !== clientId));
  }

  function moveDay(clientId: string, direction: 'up' | 'down') {
    setDays((prev) => {
      const idx = prev.findIndex((d) => d.clientId === clientId);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function swapDayPositions(clientId: string, targetClientId: string) {
    if (clientId === targetClientId) return;
    setDays((prev) => {
      const i = prev.findIndex((d) => d.clientId === clientId);
      const j = prev.findIndex((d) => d.clientId === targetClientId);
      if (i < 0 || j < 0) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function seedFromTemplate(clientId: string, templateId: string) {
    const tpl = seedTemplateById.get(templateId);
    if (!tpl) return;
    // Find the matching exercise ids: templates surface exercise *names*, but
    // we need ids to populate the day. Cross-reference by name against the
    // available exercises — this is exact-match because both lists come from
    // the same Exercise table. Planned sets/reps don't carry over from the
    // seed (they're per-template, and the lookup is name-based, so it's not
    // worth wiring through the projection); the user fills them in here.
    const nameToId = new Map(availableExercises.map((e) => [e.name, e.id]));
    const seeded: DraftExercise[] = tpl.exerciseNames
      .map((n) => nameToId.get(n))
      .filter((id): id is string => id !== undefined)
      .map((exerciseId) => ({
        exerciseId,
        plannedSets: null,
        plannedReps: null,
        plannedSeconds: null,
        note: null,
      }));
    updateDay(clientId, (d) => ({
      ...d,
      // Default the day's name to the seed's, but only if the user hasn't
      // typed something already.
      name: d.name.trim() ? d.name : tpl.name,
      exercises: seeded,
    }));
  }

  // The valid-to-save predicate: at least one day, every day has at least
  // one exercise, every weekday-pinned day in calendar mode has a unique
  // weekday. Schedule-style switching can leave weekday=null on cycle days
  // — that's fine because we strip weekdays in sequence mode anyway.
  const canSave = useMemo(() => {
    if (days.length === 0) return false;
    if (days.some((d) => d.exercises.length === 0)) return false;
    if (scheduleStyle === 'weekday') {
      const seen = new Set<number>();
      for (const d of days) {
        if (d.weekday === null) return false;
        if (seen.has(d.weekday)) return false;
        seen.add(d.weekday);
      }
    }
    return true;
  }, [days, scheduleStyle]);

  function save() {
    setSubmitError(null);
    startTransition(async () => {
      try {
        await createRoutineFromDraft({
          scheduleStyle,
          days: days.map((d) => ({
            name: d.name.trim() || undefined,
            exercises: d.exercises.map((e) => ({
              exerciseId: e.exerciseId,
              plannedSets: e.plannedSets,
              plannedReps: e.plannedReps,
              plannedSeconds: e.plannedSeconds,
              note: e.note,
            })),
            label: d.label?.trim() || undefined,
            description: d.description ?? undefined,
            weekday: scheduleStyle === 'weekday' ? d.weekday : null,
          })),
        });
        // The routine now exists server-side; drop the WIP draft so the user
        // doesn't re-hydrate stale state next time they hit /routine.
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(DRAFT_STORAGE_KEY);
        }
        router.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Could not save routine.');
      }
    });
  }

  // Compute the current preset's resolved preview. Recomputes whenever the
  // user changes the focus tab, days, duration, or equipment selection.
  // Cheap — the builder is just iterating the static base + filtering
  // variants against the available-equipment Set.
  const presetResult = useMemo(() => {
    if (presetTab === 'custom') return null;
    return buildStarterRoutine({
      focus: presetTab,
      days: presetDays,
      durationMinutes: presetDuration,
      availableEquipment,
    });
  }, [presetTab, presetDays, presetDuration, availableEquipment]);

  // Project the preset preview into the same EditorDay shape Custom mode uses,
  // so the existing coverage helpers (computeMuscleTotals, CoveragePanel) work
  // verbatim against it. Skipped for the Custom tab — that path uses the live
  // editorDays.
  const presetEditorDays: EditorDay[] = useMemo(() => {
    if (!presetResult) return [];
    const nameToId = new Map(availableExercises.map((e) => [e.name, e.id]));
    return presetResult.days.map((d, idx) => ({
      id: `preset-${idx}`,
      name: d.name,
      label: null,
      description: null,
      weekday: null,
      exercises: d.exercises
        .map((ex): DayExercise | null => {
          const id = nameToId.get(ex.exerciseName);
          if (!id) return null;
          const e = exerciseById.get(id);
          if (!e) return null;
          return {
            exerciseId: id,
            name: e.name,
            module: e.module,
            metric: e.metric,
            plannedSets: ex.plannedSets,
            plannedReps: ex.plannedReps,
            plannedSeconds: ex.plannedSeconds,
            note: null,
            videoUrl: e.videoUrl,
            equipment: e.equipment,
            primaryMuscles: e.primaryMuscles,
          };
        })
        .filter((x): x is DayExercise => x !== null),
    }));
  }, [presetResult, availableExercises, exerciseById]);

  const { totals: presetTotals, anyEstimated: presetAnyEstimated } = useMemo(
    () => computeMuscleTotals(presetEditorDays, exerciseById),
    [presetEditorDays, exerciseById],
  );

  // Apply the current preset to the Custom draft and switch tabs. Per the UX
  // spec: this *overwrites* any prior Custom WIP. The user implicitly agreed
  // to that by editing or clicking "Use this preset" — there's no separate
  // "merge with custom" flow.
  function applyPreset() {
    if (!presetResult) return;
    const nameToId = new Map(availableExercises.map((e) => [e.name, e.id]));
    const newDays: DraftDay[] = presetResult.days
      .map((d) => {
        const exercises: DraftExercise[] = [];
        for (const e of d.exercises) {
          const id = nameToId.get(e.exerciseName);
          if (!id) continue;
          exercises.push({
            exerciseId: id,
            plannedSets: e.plannedSets,
            plannedReps: e.plannedReps,
            plannedSeconds: e.plannedSeconds,
            note: null,
          });
        }
        return {
          clientId:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          name: d.name,
          label: null as string | null,
          description: null as string | null,
          weekday: null as number | null,
          exercises,
        };
      })
      .filter((d) => d.exercises.length > 0);
    setDays(newDays);
    setPresetTab('custom');
    setSubmitError(null);
  }

  const customHasContent = days.length > 0;

  return (
    <>
      <PresetTabs tab={presetTab} onChange={setPresetTab} customHasContent={customHasContent} />

      {presetTab !== 'custom' && presetResult ? (
        <PresetView
          focus={presetTab}
          days={presetDays}
          duration={presetDuration}
          availableEquipment={availableEquipment}
          result={presetResult}
          coverageTotals={presetTotals}
          coverageAnyEstimated={presetAnyEstimated}
          muscleGroups={muscleGroups}
          onChangeDays={setPresetDays}
          onChangeDuration={setPresetDuration}
          onChangeEquipment={setAvailableEquipment}
          onApply={applyPreset}
          willOverwriteCustom={customHasContent}
        />
      ) : (
        <>
          <ScheduleToggle
            value={scheduleStyle}
            onChange={(s) => setScheduleStyle(s)}
            // Switching mode leaves the days but clears weekday pins so the
            // user re-pins from scratch in calendar. We do the clear in both
            // directions to keep the data clean.
            onSwitchSideEffect={() => setDays((prev) => prev.map((d) => ({ ...d, weekday: null })))}
          />

          <div className="mt-5">
            <DaysSection
              mode="draft"
              scheduleStyle={scheduleStyle}
              days={editorDays}
              atCap={days.length >= MAX_ROUTINE_DAYS}
              isPending={isPending}
              seedTemplates={seedTemplates}
              restByExerciseId={restByExerciseId}
              muscleGroups={muscleGroups}
              exerciseById={exerciseById}
              routineTotals={totals}
              onAddDay={addDay}
              onRenameDay={(id, name) => updateDay(id, (d) => ({ ...d, name }))}
              onSetWeekday={(id, weekday) => updateDay(id, (d) => ({ ...d, weekday }))}
              onUpdateDayDescription={(id, description) =>
                updateDay(id, (d) => ({ ...d, description }))
              }
              onSortDayByModule={(id, exerciseIds) =>
                updateDay(id, (d) => {
                  const byId = new Map(d.exercises.map((e) => [e.exerciseId, e]));
                  const next = exerciseIds
                    .map((eid) => byId.get(eid))
                    .filter((e): e is DraftExercise => e !== undefined);
                  return { ...d, exercises: next };
                })
              }
              onDuplicateDay={(id) => {
                if (days.length >= MAX_ROUTINE_DAYS) return;
                const source = days.find((d) => d.clientId === id);
                if (!source) return;
                // Same semantics as the server-side duplicate: clone everything
                // except the weekday pin so the user can place the duplicate
                // explicitly. Fresh clientId keeps React keys unique.
                setDays((prev) => [
                  ...prev,
                  makeDraftDay({
                    name: source.name,
                    label: source.label,
                    description: source.description,
                    weekday: null,
                    exercises: source.exercises.map((e) => ({ ...e })),
                  }),
                ]);
              }}
              onRemoveDay={removeDay}
              onMoveDay={moveDay}
              onSwapDayPositions={swapDayPositions}
              onOpenExercisePicker={setPickerForDayClientId}
              onSeedFromTemplate={seedFromTemplate}
              onRemoveExercise={(id, exerciseId) =>
                updateDay(id, (d) => ({
                  ...d,
                  exercises: d.exercises.filter((e) => e.exerciseId !== exerciseId),
                }))
              }
              onReorderExercise={(id, exerciseId, direction) =>
                updateDay(id, (d) => {
                  const idx = d.exercises.findIndex((e) => e.exerciseId === exerciseId);
                  if (idx < 0) return d;
                  const target = direction === 'up' ? idx - 1 : idx + 1;
                  if (target < 0 || target >= d.exercises.length) return d;
                  const next = [...d.exercises];
                  [next[idx], next[target]] = [next[target], next[idx]];
                  return { ...d, exercises: next };
                })
              }
              onUpdateExercisePlanned={(id, exerciseId, planned) =>
                updateDay(id, (d) => ({
                  ...d,
                  exercises: d.exercises.map((e) =>
                    e.exerciseId === exerciseId ? { ...e, ...planned } : e,
                  ),
                }))
              }
              onSwapExercise={null}
            />
          </div>

          <CoveragePanel totals={totals} anyEstimated={anyEstimated} muscleGroups={muscleGroups} />

          <div className="mt-6 border border-ink-800 rounded-lg p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-ink-100">Save your routine</div>
              <div className="text-[11px] text-ink-500 italic font-display mt-0.5 leading-relaxed">
                {canSave
                  ? 'Looks good — commit it when you’re ready.'
                  : days.length === 0
                    ? 'Add at least one day with one exercise.'
                    : scheduleStyle === 'weekday'
                      ? 'Each day needs a weekday and at least one exercise.'
                      : 'Each day needs at least one exercise.'}
              </div>
              {submitError && <p className="text-[11px] text-bad mt-1.5">{submitError}</p>}
            </div>
            <button
              onClick={save}
              disabled={!canSave || isPending}
              className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              {isPending ? 'Saving…' : 'Save routine'}
            </button>
          </div>
        </>
      )}

      {pickerForDayClientId &&
        (() => {
          const draftDay = days.find((d) => d.clientId === pickerForDayClientId);
          if (!draftDay) return null;
          const excludeIds = new Set(draftDay.exercises.map((e) => e.exerciseId));
          return (
            <ExercisePicker
              availableExercises={availableExercises}
              excludeIds={excludeIds}
              gapMuscles={gapMuscles}
              onPickMany={(exerciseIds) => {
                setPickerForDayClientId(null);
                updateDay(draftDay.clientId, (d) => {
                  const have = new Set(d.exercises.map((e) => e.exerciseId));
                  const additions: DraftExercise[] = exerciseIds
                    .filter((id) => !have.has(id))
                    .map((exerciseId) => ({
                      exerciseId,
                      plannedSets: null,
                      plannedReps: null,
                      plannedSeconds: null,
                      note: null,
                    }));
                  return { ...d, exercises: [...d.exercises, ...additions] };
                });
              }}
              onClose={() => setPickerForDayClientId(null)}
              onCreateCustom={(
                name,
                primary,
                secondary,
                prescription,
                videoUrl,
                restTimerSeconds,
              ) => {
                startTransition(async () => {
                  await createCustomExercise({
                    name,
                    primaryMuscles: primary,
                    secondaryMuscles: secondary,
                    prescription,
                    videoUrl,
                    restTimerSeconds,
                  });
                  router.refresh();
                });
              }}
              onDeleteCustom={(exerciseId) => {
                startTransition(async () => {
                  await deleteCustomExercise({ exerciseId });
                  router.refresh();
                });
              }}
            />
          );
        })()}
    </>
  );
}

// ============ PRESET PICKER (Draft mode only) ============

// Top tabs: three focuses + Custom. Selecting a focus tab is read-only preview;
// Custom is the editable WIP draft. Tab order is intentional — Strength /
// Build / Mobility flow heaviest → lightest, then Custom anchors as the
// "your hand-rolled" option on the right.
function PresetTabs({
  tab,
  onChange,
  customHasContent,
}: {
  tab: PresetTab;
  onChange: (next: PresetTab) => void;
  customHasContent: boolean;
}) {
  const tabs: { value: PresetTab; label: string }[] = [
    { value: 'strength', label: STARTER_FOCUS_INFO.strength.label },
    { value: 'build', label: STARTER_FOCUS_INFO.build.label },
    { value: 'mobility', label: STARTER_FOCUS_INFO.mobility.label },
    { value: 'longevity', label: STARTER_FOCUS_INFO.longevity.label },
    { value: 'custom', label: 'Custom' },
  ];
  return (
    <div className="mb-4">
      <div className="flex gap-1 border-b border-ink-800">
        {tabs.map((t) => {
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              className={`px-3 py-2 text-[12px] tracking-wide transition border-b-2 -mb-px ${
                active
                  ? 'accent-text border-accent'
                  : 'text-ink-500 border-transparent hover:text-ink-200'
              }`}
            >
              {t.label}
              {t.value === 'custom' && customHasContent && (
                <span
                  className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full accent-bg align-middle"
                  aria-hidden="true"
                  title="You have a saved draft"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Read-only preview of a (focus × days × duration × equipment) preset.
// Filter pills + the per-token equipment selector are above; the days
// preview and a coverage snapshot are below; an explicit "Use this preset"
// CTA at the bottom copies into Custom and switches tabs. Editing the
// resulting days happens in the Custom tab — preset previews are never
// directly editable, by design.
function PresetView({
  focus,
  days,
  duration,
  availableEquipment,
  result,
  coverageTotals,
  coverageAnyEstimated,
  muscleGroups,
  onChangeDays,
  onChangeDuration,
  onChangeEquipment,
  onApply,
  willOverwriteCustom,
}: {
  focus: StarterFocus;
  days: number;
  duration: StarterDuration;
  availableEquipment: ReadonlySet<string>;
  result: ReturnType<typeof buildStarterRoutine>;
  coverageTotals: MuscleTotals;
  coverageAnyEstimated: boolean;
  muscleGroups: MuscleGroupClient[];
  onChangeDays: (n: number) => void;
  onChangeDuration: (n: StarterDuration) => void;
  onChangeEquipment: (next: Set<string>) => void;
  onApply: () => void;
  willOverwriteCustom: boolean;
}) {
  const focusInfo = STARTER_FOCUS_INFO[focus];
  return (
    <div>
      <div className="mb-4">
        <p className="text-[12px] text-ink-300 leading-relaxed">{focusInfo.description}</p>
      </div>

      {/* Days + duration */}
      <div className="space-y-3 mb-5">
        <PillRow
          label="Days / cycle"
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))}
          value={days}
          onChange={onChangeDays}
        />
        <PillRow
          label="Time / day"
          options={STARTER_DURATIONS.map((n) => ({ value: n, label: `${n}m` }))}
          value={duration}
          onChange={onChangeDuration}
        />
      </div>

      {/* Equipment selector */}
      <EquipmentSelector available={availableEquipment} onChange={onChangeEquipment} />

      {/* Tradeoffs / mat hint */}
      {(result.tradeoffs.length > 0 || result.needsMat) && (
        <div className="mt-5 mb-4 space-y-1.5">
          {result.tradeoffs.map((msg) => (
            <p key={msg} className="text-[11px] text-ink-400 italic font-display leading-relaxed">
              {msg}
            </p>
          ))}
          {result.needsMat && (
            <p className="text-[11px] text-ink-500 font-display leading-relaxed">
              You&apos;ll want a mat for floor work.
            </p>
          )}
        </div>
      )}

      {/* Days preview */}
      <div className="space-y-2.5 mt-5 mb-5">
        {result.days.length === 0 ? (
          <p className="text-[12px] text-ink-500 italic font-display">
            No exercises matched at this combination — try toggling more equipment on or picking a
            longer duration.
          </p>
        ) : (
          result.days.map((d, idx) => (
            <div key={idx} className="border border-ink-800 rounded-lg p-3">
              <div className="text-[11px] tracking-wider uppercase text-ink-500 mb-1.5">
                {d.name}
              </div>
              {d.exercises.length === 0 ? (
                <div className="text-[11px] text-ink-500 italic font-display">
                  Empty after trim — pick a longer duration.
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {d.exercises.map((ex, j) => (
                    <li
                      key={j}
                      className="flex items-center justify-between gap-3 text-[12px] text-ink-200"
                    >
                      <span className="truncate">{ex.exerciseName}</span>
                      <span className="text-ink-500 font-mono text-[10px] shrink-0">
                        {ex.plannedSets}×
                        {ex.plannedSeconds !== null
                          ? `${ex.plannedSeconds}s`
                          : (ex.plannedReps ?? '—')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>

      {/* Coverage snapshot — same component the Custom mode uses, fed by the
          preview's projected day list. Lets the user see at a glance which
          muscles the current (focus × days × duration × equipment) hits. */}
      <CoveragePanel
        totals={coverageTotals}
        anyEstimated={coverageAnyEstimated}
        muscleGroups={muscleGroups}
      />

      {/* Use-this-preset CTA */}
      <button
        onClick={onApply}
        disabled={result.days.every((d) => d.exercises.length === 0)}
        className="mt-6 w-full accent-bg text-ink-950 px-4 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Use this preset{' '}
        {willOverwriteCustom && (
          <span className="font-normal opacity-80">— replaces your current draft</span>
        )}
      </button>
    </div>
  );
}

// Per-token equipment selector. Quick-set pills snap the whole Set to a named
// tier; the grouped checkbox-style pills below let users hand-toggle. The
// quick-set row highlights the matching tier (or none, if the user has a
// hand-rolled mix).
function EquipmentSelector({
  available,
  onChange,
}: {
  available: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  // Detect which tier (if any) the current selection matches exactly. Compares
  // by Set equality. A null result means the user has a custom mix.
  const matchedTier: EquipmentTier | null = useMemo(() => {
    for (const tier of EQUIPMENT_TIERS) {
      const tierSet = TIER_EQUIPMENT[tier];
      if (tierSet.size !== available.size) continue;
      let same = true;
      for (const t of tierSet) {
        if (!available.has(t)) {
          same = false;
          break;
        }
      }
      if (same) return tier;
    }
    return null;
  }, [available]);

  function toggle(token: string) {
    const next = new Set(available);
    if (next.has(token)) next.delete(token);
    else next.add(token);
    onChange(next);
  }

  function snapToTier(tier: EquipmentTier) {
    onChange(new Set(TIER_EQUIPMENT[tier]));
  }

  return (
    <div className="border border-ink-800 rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="text-[10px] tracking-[0.2em] uppercase text-ink-500 w-24 shrink-0">
          Equipment
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EQUIPMENT_TIERS.map((tier) => {
            const active = matchedTier === tier;
            return (
              <button
                key={tier}
                onClick={() => snapToTier(tier)}
                className={`px-2.5 py-1 text-[11px] rounded-full border transition ${
                  active
                    ? 'accent-bg accent-border text-ink-950 font-medium'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600 hover:text-ink-100'
                }`}
              >
                {EQUIPMENT_TIER_INFO[tier].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        {EQUIPMENT_GROUPS.map((group) => (
          <div key={group.label} className="flex items-start gap-2 flex-wrap">
            <div className="text-[10px] tracking-[0.15em] uppercase text-ink-600 w-24 shrink-0 pt-1">
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.tokens.map((token) => {
                const on = available.has(token);
                const label = EQUIPMENT_LABELS[token] ?? token;
                return (
                  <button
                    key={token}
                    onClick={() => toggle(token)}
                    aria-pressed={on}
                    className={`px-2 py-0.5 text-[11px] rounded-full border transition ${
                      on
                        ? 'border-accent/60 accent-text bg-accent/10'
                        : 'border-ink-800 text-ink-500 hover:border-ink-600 hover:text-ink-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Generic pill-row used by the preset filters. Single-select.
function PillRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="text-[10px] tracking-[0.2em] uppercase text-ink-500 w-24 shrink-0">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              onClick={() => onChange(opt.value)}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition ${
                active
                  ? 'accent-bg accent-border text-ink-950 font-medium'
                  : 'border-ink-800 text-ink-300 hover:border-ink-600 hover:text-ink-100'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============ LIVE EDITOR ============

function LiveEditor({
  routine,
  seedTemplates,
  availableExercises,
  muscleGroups,
}: {
  routine: RoutineClient;
  seedTemplates: SeedTemplateClient[];
  availableExercises: ExerciseInfo[];
  muscleGroups: MuscleGroupClient[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const { prefs } = usePrefs();

  const [pickerForDayId, setPickerForDayId] = useState<string | null>(null);
  const [swapForDay, setSwapForDay] = useState<{ dayId: string; outExerciseId: string } | null>(
    null,
  );

  // Effective rest per exercise (override → global default). DayCard uses
  // this to render day-total and per-module subtotal time estimates.
  const restByExerciseId = useMemo(
    () =>
      new Map(
        availableExercises.map(
          (e) => [e.id, e.restTimerSecondsOverride ?? prefs.restTimerSeconds] as const,
        ),
      ),
    [availableExercises, prefs.restTimerSeconds],
  );

  // Same totals derivation as DraftEditor — see the comment there. Live mode
  // is server-authoritative so the dependencies are routine.days +
  // availableExercises.
  const exerciseById = useMemo(
    () => new Map(availableExercises.map((e) => [e.id, e])),
    [availableExercises],
  );

  const editorDays: EditorDay[] = useMemo(
    () =>
      [...routine.days]
        .sort((a, b) => a.position - b.position)
        .map((d) => ({
          id: d.id,
          name: d.name,
          label: d.label,
          description: d.description,
          weekday: d.weekday,
          exercises: d.exercises
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((e) => {
              const av = exerciseById.get(e.exerciseId);
              return {
                exerciseId: e.exerciseId,
                name: e.name,
                module: e.module,
                metric: e.metric,
                plannedSets: e.plannedSets,
                plannedReps: e.plannedReps,
                plannedSeconds: e.plannedSeconds,
                note: e.note,
                videoUrl: av?.videoUrl ?? null,
                equipment: av?.equipment ?? [],
                primaryMuscles: av?.primaryMuscles ?? [],
              };
            }),
        })),
    [routine.days, exerciseById],
  );
  const { totals, anyEstimated } = useMemo(
    () => computeMuscleTotals(editorDays, exerciseById),
    [editorDays, exerciseById],
  );
  const gapMuscles = useMemo(
    () => gapMusclesFromTotals(totals, muscleGroups),
    [totals, muscleGroups],
  );

  return (
    <>
      <MetaPanel routine={routine} isPending={isPending} startTransition={startTransition} />

      <DaysSection
        mode="live"
        scheduleStyle={routine.scheduleStyle}
        days={editorDays}
        atCap={routine.days.length >= MAX_ROUTINE_DAYS}
        isPending={isPending}
        seedTemplates={seedTemplates}
        restByExerciseId={restByExerciseId}
        muscleGroups={muscleGroups}
        exerciseById={exerciseById}
        routineTotals={totals}
        onAddDay={(weekday) => {
          startTransition(async () => {
            try {
              await addRoutineDay({
                weekday: routine.scheduleStyle === 'weekday' ? weekday : null,
              });
            } catch {
              /* surfaced to console; user-visible errors stay rare here */
            }
          });
        }}
        onRenameDay={(id, name) => {
          startTransition(() => {
            updateRoutineDay({ routineDayId: id, name }).catch(() => {});
          });
        }}
        onSetWeekday={(id, weekday) => {
          startTransition(() => {
            updateRoutineDay({ routineDayId: id, weekday }).catch(() => {});
          });
        }}
        onUpdateDayDescription={(id, description) => {
          startTransition(() => {
            updateRoutineDay({ routineDayId: id, description }).catch(() => {});
          });
        }}
        onSortDayByModule={(id, exerciseIds) => {
          startTransition(() => {
            setRoutineDayExerciseOrder({ routineDayId: id, exerciseIds }).catch(() => {});
          });
        }}
        onDuplicateDay={(id) => {
          startTransition(() => {
            duplicateRoutineDay({ routineDayId: id }).catch(() => {});
          });
        }}
        onRemoveDay={async (id) => {
          const day = editorDays.find((d) => d.id === id);
          const ok = await confirm({
            title: `Remove "${day?.name ?? 'this day'}"?`,
            message:
              'The day and its exercise list go away. Sessions you already completed from it stay in your history.',
            confirmLabel: 'Remove',
            variant: 'danger',
          });
          if (!ok) return;
          startTransition(() => {
            removeRoutineDay({ routineDayId: id });
          });
        }}
        onMoveDay={(id, direction) => {
          startTransition(() => {
            reorderRoutineDay({ routineDayId: id, direction });
          });
        }}
        onSwapDayPositions={(id, targetId) => {
          startTransition(() => {
            swapRoutineDayPositions({ routineDayId: id, targetRoutineDayId: targetId });
          });
        }}
        onOpenExercisePicker={setPickerForDayId}
        onSeedFromTemplate={(id, templateId) => {
          // In live mode, "seed from template" while the day already has
          // exercises is awkward — we don't merge; we replace by removing
          // existing then re-adding via the multi-pick path. Keep this
          // affordance only for empty days; DayCard hides it once exercises
          // exist. The seed action below clones the template's exercises by
          // calling addExerciseToRoutineDay for each one in order.
          const tpl = seedTemplates.find((t) => t.id === templateId);
          if (!tpl) return;
          const nameToId = new Map(availableExercises.map((e) => [e.name, e.id]));
          const ids = tpl.exerciseNames
            .map((n) => nameToId.get(n))
            .filter((eid): eid is string => eid !== undefined);
          startTransition(async () => {
            for (const eid of ids) {
              await addExerciseToRoutineDay({ routineDayId: id, exerciseId: eid });
            }
            router.refresh();
          });
        }}
        onRemoveExercise={(id, exerciseId) => {
          startTransition(() => {
            removeExerciseFromRoutineDay({ routineDayId: id, exerciseId });
          });
        }}
        onReorderExercise={(id, exerciseId, direction) => {
          startTransition(() => {
            reorderRoutineDayExercise({ routineDayId: id, exerciseId, direction });
          });
        }}
        onUpdateExercisePlanned={(id, exerciseId, planned) => {
          startTransition(() => {
            updateRoutineDayExercise({
              routineDayId: id,
              exerciseId,
              ...planned,
            }).catch(() => {});
          });
        }}
        onSwapExercise={(id, exerciseId) => setSwapForDay({ dayId: id, outExerciseId: exerciseId })}
      />

      <CoveragePanel totals={totals} anyEstimated={anyEstimated} muscleGroups={muscleGroups} />

      <DangerZone
        routineName={routine.name}
        isPending={isPending}
        startTransition={startTransition}
        confirm={confirm}
      />

      {pickerForDayId &&
        (() => {
          const day = editorDays.find((d) => d.id === pickerForDayId);
          if (!day) return null;
          const excludeIds = new Set(day.exercises.map((e) => e.exerciseId));
          return (
            <ExercisePicker
              availableExercises={availableExercises}
              excludeIds={excludeIds}
              gapMuscles={gapMuscles}
              onPickMany={(exerciseIds) => {
                setPickerForDayId(null);
                startTransition(async () => {
                  for (const exerciseId of exerciseIds) {
                    await addExerciseToRoutineDay({ routineDayId: day.id, exerciseId });
                  }
                  router.refresh();
                });
              }}
              onClose={() => setPickerForDayId(null)}
              onCreateCustom={(
                name,
                primary,
                secondary,
                prescription,
                videoUrl,
                restTimerSeconds,
              ) => {
                startTransition(async () => {
                  await createCustomExercise({
                    name,
                    primaryMuscles: primary,
                    secondaryMuscles: secondary,
                    prescription,
                    videoUrl,
                    restTimerSeconds,
                  });
                  router.refresh();
                });
              }}
              onDeleteCustom={(exerciseId) => {
                startTransition(async () => {
                  await deleteCustomExercise({ exerciseId });
                  router.refresh();
                });
              }}
            />
          );
        })()}

      {swapForDay &&
        (() => {
          const day = editorDays.find((d) => d.id === swapForDay.dayId);
          if (!day) return null;
          const excludeIds = new Set(day.exercises.map((e) => e.exerciseId));
          return (
            <ExercisePicker
              availableExercises={availableExercises}
              excludeIds={excludeIds}
              gapMuscles={gapMuscles}
              onPickMany={(exerciseIds) => {
                const inExerciseId = exerciseIds[0];
                const target = swapForDay;
                setSwapForDay(null);
                if (!inExerciseId) return;
                startTransition(async () => {
                  await swapInRoutineTemplate({
                    routineDayId: target.dayId,
                    outExerciseId: target.outExerciseId,
                    inExerciseId,
                  });
                  router.refresh();
                });
              }}
              onClose={() => setSwapForDay(null)}
              onCreateCustom={(
                name,
                primary,
                secondary,
                prescription,
                videoUrl,
                restTimerSeconds,
              ) => {
                startTransition(async () => {
                  await createCustomExercise({
                    name,
                    primaryMuscles: primary,
                    secondaryMuscles: secondary,
                    prescription,
                    videoUrl,
                    restTimerSeconds,
                  });
                  router.refresh();
                });
              }}
              onDeleteCustom={(exerciseId) => {
                startTransition(async () => {
                  await deleteCustomExercise({ exerciseId });
                  router.refresh();
                });
              }}
            />
          );
        })()}

      {ConfirmDialog}
    </>
  );
}

// ============ META PANEL (Live mode) ============

function MetaPanel({
  routine,
  isPending,
  startTransition,
}: {
  routine: RoutineClient;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const [name, setName] = useState(routine.name);
  const [description, setDescription] = useState(routine.description ?? '');

  // Sync local state with server-revalidated props if they change while
  // the inputs aren't focused. This keeps stale text from snapping back
  // mid-typing but still picks up upstream changes.
  useEffect(() => {
    setName(routine.name);
  }, [routine.name]);
  useEffect(() => {
    setDescription(routine.description ?? '');
  }, [routine.description]);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setName(routine.name);
      return;
    }
    if (trimmed === routine.name) return;
    startTransition(() => {
      updateRoutine({ name: trimmed }).catch(() => setName(routine.name));
    });
  }

  function commitDescription() {
    const next = description.trim() || null;
    if (next === routine.description) return;
    startTransition(() => {
      updateRoutine({ description: next }).catch(() => setDescription(routine.description ?? ''));
    });
  }

  function setSchedule(next: ScheduleStyle) {
    if (next === routine.scheduleStyle) return;
    // Optimistic note: the action clears weekday pins server-side; we don't
    // need a confirm dialog because the inline hint above the toggle
    // already explains it, and the change is reversible (one click back).
    startTransition(() => {
      updateRoutine({ scheduleStyle: next });
    });
  }

  return (
    <div className="border border-ink-800 rounded-lg p-4 space-y-4 mb-5">
      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setName(routine.name);
              e.currentTarget.blur();
            }
          }}
          disabled={isPending}
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50 disabled:opacity-60"
        />
      </div>

      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          What&apos;s it for? <span className="text-ink-600">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDescription(routine.description ?? '');
              e.currentTarget.blur();
            }
          }}
          disabled={isPending}
          placeholder="A note to your future self"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50 disabled:opacity-60"
        />
      </div>

      <ScheduleToggle value={routine.scheduleStyle} onChange={setSchedule} />
    </div>
  );
}

// ============ SCHEDULE TOGGLE (shared) ============

function ScheduleToggle({
  value,
  onChange,
  onSwitchSideEffect,
}: {
  value: ScheduleStyle;
  onChange: (s: ScheduleStyle) => void;
  onSwitchSideEffect?: () => void;
}) {
  function pick(next: ScheduleStyle) {
    if (next === value) return;
    onChange(next);
    onSwitchSideEffect?.();
  }
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400 inline-flex items-center gap-1">
          Schedule style
          <InfoTooltip label="Cycle vs Calendar" size={11} align="start">
            {ExplainScheduleStyle}
          </InfoTooltip>
        </div>
        <div className="text-[10px] text-ink-600 italic font-display text-right">
          Switching modes keeps your days but clears any weekday pins.
        </div>
      </div>
      <div className="flex gap-1.5">
        <ToggleOption
          active={value === 'sequence'}
          onClick={() => pick('sequence')}
          title="Cycle"
          description="Self-paced rotation."
        />
        <ToggleOption
          active={value === 'weekday'}
          onClick={() => pick('weekday')}
          title="Calendar"
          description="Pin to weekdays."
        />
      </div>
    </div>
  );
}

function ToggleOption({
  active,
  onClick,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left border rounded-lg px-3 py-2 transition ${
        active ? 'border-accent bg-accent/5' : 'border-ink-800 hover:border-ink-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2.5 h-2.5 rounded-full border ${
            active ? 'accent-bg border-transparent' : 'border-ink-600'
          }`}
        />
        <span className="text-sm text-ink-100">{title}</span>
      </div>
      <div className="text-[11px] text-ink-500 italic font-display mt-0.5 ml-4 leading-relaxed">
        {description}
      </div>
    </button>
  );
}

// ============ DAYS SECTION (shared by both modes) ============

// Patches the editor row sends back to its parent. Misnamed historically —
// covers the free-text note too, not just the planned numerics — kept as one
// shape so the action layer can apply set/rep/second/note edits uniformly.
type PlannedPatch = {
  plannedSets?: number | null;
  plannedReps?: number | null;
  plannedSeconds?: number | null;
  note?: string | null;
};

type DaysSectionProps = {
  mode: 'draft' | 'live';
  scheduleStyle: ScheduleStyle;
  days: EditorDay[];
  atCap: boolean;
  isPending: boolean;
  seedTemplates: SeedTemplateClient[];
  onAddDay: (weekday: number | null) => void;
  onRenameDay: (id: string, name: string) => void;
  onSetWeekday: (id: string, weekday: number | null) => void;
  onUpdateDayDescription: (id: string, description: string | null) => void;
  // Reorder the day's exercises in bulk to match canonical module order. The
  // caller already has the full day data and can compute the new sequence;
  // this just commits it.
  onSortDayByModule: (id: string, exerciseIds: string[]) => void;
  // Append a clone of the day at the end of the routine, up to the day cap.
  onDuplicateDay: (id: string) => void;
  onRemoveDay: (id: string) => void;
  onMoveDay: (id: string, direction: 'up' | 'down') => void;
  // Swap two days' positions in one click — used by the cycle-mode Day-N grid.
  onSwapDayPositions: (id: string, targetId: string) => void;
  onOpenExercisePicker: (id: string) => void;
  onSeedFromTemplate: (id: string, templateId: string) => void;
  onRemoveExercise: (id: string, exerciseId: string) => void;
  onReorderExercise: (id: string, exerciseId: string, direction: 'up' | 'down') => void;
  onUpdateExercisePlanned: (id: string, exerciseId: string, patch: PlannedPatch) => void;
  // Null disables the swap button (e.g. in draft mode).
  onSwapExercise: ((id: string, exerciseId: string) => void) | null;
  // Per-exercise effective rest seconds (override → global default). Lets
  // DayCard estimate per-exercise time without re-resolving the user's prefs.
  restByExerciseId: Map<string, number>;
  // Coverage context — DayCard renders a per-day strip showing what each day
  // contributes, coloured by the muscle's *weekly* status so the user can see
  // "this day hits chest, which is currently below min weekly".
  muscleGroups: MuscleGroupClient[];
  exerciseById: Map<string, ExerciseInfo>;
  routineTotals: MuscleTotals;
};

function DaysSection(props: DaysSectionProps) {
  if (props.scheduleStyle === 'sequence') {
    return <SequenceView {...props} />;
  }
  return <WeekdayView {...props} />;
}

function SequenceView(props: DaysSectionProps) {
  const { days, atCap, mode, onAddDay, isPending } = props;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-ink-100">Days</h2>
        <span className="text-[11px] text-ink-500 font-mono">
          {days.length} / {MAX_ROUTINE_DAYS}
        </span>
      </div>

      {days.map((day, idx) => (
        <DayCard
          key={day.id}
          day={day}
          scheduleStyle="sequence"
          allDays={days}
          canMoveUp={idx > 0}
          canMoveDown={idx < days.length - 1}
          {...dispatchProps(props)}
        />
      ))}

      {!atCap && (
        <button
          onClick={() => onAddDay(null)}
          disabled={isPending}
          className="w-full border border-dashed border-ink-700 rounded-lg py-3 text-sm text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Plus size={14} /> Add a day
        </button>
      )}

      {atCap && (
        <p className="text-[11px] text-ink-500 italic font-display">
          Routine cap is {MAX_ROUTINE_DAYS} days.{' '}
          {mode === 'draft' ? 'Remove one to add another.' : ''}
        </p>
      )}
    </div>
  );
}

function WeekdayView(props: DaysSectionProps) {
  const { days, atCap, isPending, onAddDay } = props;

  // Mon..Sun visual order — matches how the rest of the UI orients weeks.
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
  const dayByWeekday = new Map<number, EditorDay>();
  const unassigned: EditorDay[] = [];
  for (const d of days) {
    if (d.weekday !== null) dayByWeekday.set(d.weekday, d);
    else unassigned.push(d);
  }

  return (
    <div className="space-y-3">
      {unassigned.length > 0 && (
        <div className="border border-bad/30 rounded-lg p-3 space-y-2">
          <div className="text-[10px] tracking-[0.25em] uppercase text-bad/80">
            Unassigned ({unassigned.length})
          </div>
          <p className="text-[11px] text-ink-400 italic font-display leading-relaxed">
            These days don&apos;t have a weekday yet. Pick one in each card or remove the day.
          </p>
          <div className="space-y-2">
            {unassigned.map((day) => (
              <DayCard
                key={day.id}
                day={day}
                scheduleStyle="weekday"
                allDays={days}
                canMoveUp={false}
                canMoveDown={false}
                {...dispatchProps(props)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm text-ink-100">Week</h2>
          <span className="text-[11px] text-ink-500 font-mono">
            {days.length} / {MAX_ROUTINE_DAYS}
          </span>
        </div>
        {weekdayOrder.map((wd) => {
          const day = dayByWeekday.get(wd);
          if (day) {
            return (
              <DayCard
                key={day.id}
                day={day}
                scheduleStyle="weekday"
                allDays={days}
                canMoveUp={false}
                canMoveDown={false}
                {...dispatchProps(props)}
              />
            );
          }
          return (
            <button
              key={wd}
              onClick={() => !atCap && onAddDay(wd)}
              disabled={atCap || isPending}
              className="w-full border border-ink-900 bg-ink-900/30 rounded-lg px-3 py-2.5 text-left hover:border-accent/40 hover:bg-ink-900/60 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2"
            >
              <div className="text-[13px] text-ink-400 flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-500 w-9">{WEEKDAY_LABELS[wd]}</span>
                <span className="italic font-display">— rest day —</span>
              </div>
              {!atCap && (
                <span className="text-[11px] text-ink-500 inline-flex items-center gap-1">
                  <Plus size={12} /> Add
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Pull the per-day callbacks off the section props so DayCard receives them
// as a single bag without us spelling each one out at every call site.
function dispatchProps(p: DaysSectionProps) {
  return {
    isPending: p.isPending,
    seedTemplates: p.seedTemplates,
    onRename: p.onRenameDay,
    onSetWeekday: p.onSetWeekday,
    onUpdateDescription: p.onUpdateDayDescription,
    onSortByModule: p.onSortDayByModule,
    onDuplicate: p.onDuplicateDay,
    onRemove: p.onRemoveDay,
    atCap: p.atCap,
    onMove: p.onMoveDay,
    onSwapPositions: p.onSwapDayPositions,
    onOpenExercisePicker: p.onOpenExercisePicker,
    onSeedFromTemplate: p.onSeedFromTemplate,
    onRemoveExercise: p.onRemoveExercise,
    onReorderExercise: p.onReorderExercise,
    onUpdateExercisePlanned: p.onUpdateExercisePlanned,
    onSwapExercise: p.onSwapExercise,
    restByExerciseId: p.restByExerciseId,
    muscleGroups: p.muscleGroups,
    exerciseById: p.exerciseById,
    routineTotals: p.routineTotals,
  };
}

// ============ DAY CARD (shared) ============

type DayCardProps = {
  day: EditorDay;
  scheduleStyle: ScheduleStyle;
  allDays: EditorDay[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  isPending: boolean;
  seedTemplates: SeedTemplateClient[];
  onRename: (id: string, name: string) => void;
  onSetWeekday: (id: string, weekday: number | null) => void;
  onUpdateDescription: (id: string, description: string | null) => void;
  onSortByModule: (id: string, exerciseIds: string[]) => void;
  onDuplicate: (id: string) => void;
  // Routine is at the day cap — duplicate is disabled.
  atCap: boolean;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onSwapPositions: (id: string, targetId: string) => void;
  onOpenExercisePicker: (id: string) => void;
  onSeedFromTemplate: (id: string, templateId: string) => void;
  onRemoveExercise: (id: string, exerciseId: string) => void;
  onReorderExercise: (id: string, exerciseId: string, direction: 'up' | 'down') => void;
  onUpdateExercisePlanned: (id: string, exerciseId: string, patch: PlannedPatch) => void;
  onSwapExercise: ((id: string, exerciseId: string) => void) | null;
  restByExerciseId: Map<string, number>;
  muscleGroups: MuscleGroupClient[];
  exerciseById: Map<string, ExerciseInfo>;
  routineTotals: MuscleTotals;
};

function DayCard({
  day,
  scheduleStyle,
  allDays,
  canMoveUp,
  canMoveDown,
  isPending,
  seedTemplates,
  onRename,
  onSetWeekday,
  onUpdateDescription,
  onSortByModule,
  onDuplicate,
  atCap,
  onRemove,
  onMove,
  onSwapPositions,
  onOpenExercisePicker,
  onSeedFromTemplate,
  onRemoveExercise,
  onReorderExercise,
  onUpdateExercisePlanned,
  onSwapExercise,
  restByExerciseId,
  muscleGroups,
  exerciseById,
  routineTotals,
}: DayCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(day.name);
  // Keep the local input in sync with upstream changes (e.g. seed-from-template
  // updating the day's name).
  useEffect(() => {
    setName(day.name);
  }, [day.name]);

  // Day-level description editor. Collapsed by default; click-to-expand. Same
  // commit-on-blur pattern as the per-exercise note. Local string state while
  // focused, sync from upstream only when not editing.
  const [descOpen, setDescOpen] = useState(false);
  const [descText, setDescText] = useState(day.description ?? '');
  useEffect(() => {
    if (!descOpen) setDescText(day.description ?? '');
  }, [day.description, descOpen]);
  const descHasContent = (day.description ?? '').trim().length > 0;

  function commitDescription() {
    const trimmed = descText.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next !== day.description) onUpdateDescription(day.id, next);
  }

  // Module-aware grouping for the rendered exercise list. Within-group order
  // preserves the user's intent (position order of items sharing a module);
  // group order follows the canonical SMR→Mobility→Activation→Strength→
  // Balance→Rev Up sequence defined in lib/exercises-data.ts. Sort button
  // below uses the same flattening to write canonical positions in one shot.
  const moduleGroups = useMemo(() => groupExercisesByModule(day.exercises), [day.exercises]);
  const alreadySorted = useMemo(() => isCanonicalModuleOrder(day.exercises), [day.exercises]);

  // Time estimates summed at three levels: per exercise (used implicitly for
  // group/day totals), per module group, and per day. Per-exercise rest comes
  // from the user's override or the global default (resolved by the parent
  // and passed in via restByExerciseId). Exercises without planned sets fall
  // back to the seeder's defaults — same behavior as the coverage panel, so
  // the time and volume readouts agree on what an "estimated" set looks like.
  const { dayEstimateSec, groupEstimateSec } = useMemo(() => {
    const perGroup = new Map<string, number>();
    let dayTotal = 0;
    for (const group of moduleGroups) {
      let groupTotal = 0;
      for (const ex of group.exercises) {
        const seconds = estimatePlannedExerciseSeconds({
          metric: ex.metric,
          plannedSets: ex.plannedSets,
          plannedReps: ex.plannedReps,
          plannedSeconds: ex.plannedSeconds,
          restSeconds: restByExerciseId.get(ex.exerciseId) ?? 90,
        });
        groupTotal += seconds;
      }
      perGroup.set(group.module, groupTotal);
      dayTotal += groupTotal;
    }
    return { dayEstimateSec: dayTotal, groupEstimateSec: perGroup };
  }, [moduleGroups, restByExerciseId]);

  const takenWeekdays = new Set(
    allDays.filter((d) => d.id !== day.id && d.weekday !== null).map((d) => d.weekday as number),
  );

  function commitRename() {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === day.name) {
      setName(day.name);
      return;
    }
    onRename(day.id, trimmed);
  }

  return (
    <div className="border border-ink-800 rounded-lg overflow-hidden">
      <div className="bg-ink-900/40 px-3 py-2 flex items-center justify-between border-b border-ink-900">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {scheduleStyle === 'sequence' && (
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                onClick={() => onMove(day.id, 'up')}
                disabled={!canMoveUp || isPending}
                className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label="Move day up"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => onMove(day.id, 'down')}
                disabled={!canMoveDown || isPending}
                className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label="Move day down"
              >
                <ChevronDown size={12} />
              </button>
            </div>
          )}
          <DayPositionBadge
            scheduleStyle={scheduleStyle}
            position={allDays.findIndex((d) => d.id === day.id) + 1}
            weekday={day.weekday}
          />
          {renaming ? (
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(day.name);
                  setRenaming(false);
                }
              }}
              className="bg-ink-950 border border-ink-800 rounded px-2 py-1 text-sm text-ink-100 focus:outline-none focus:border-accent/50 flex-1 min-w-0"
            />
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="text-sm text-ink-100 hover:text-accent transition truncate text-left min-w-0"
            >
              {day.name}
            </button>
          )}
          {dayEstimateSec > 0 && (
            <span
              className="text-[11px] text-ink-500 font-mono shrink-0"
              title="Estimated time at typical pace — sum of planned sets × rest, not a deadline."
            >
              ~{formatEstimateCompact(dayEstimateSec)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {/* Sort-by-module: writes positions to canonical SMR→…→Rev Up order
              with intra-module sequence preserved. Disabled when already
              canonical or when there's nothing to sort. */}
          {day.exercises.length > 1 && (
            <button
              onClick={() =>
                onSortByModule(
                  day.id,
                  sortExercisesByModule(day.exercises).map((e) => e.exerciseId),
                )
              }
              disabled={isPending || alreadySorted}
              className="text-ink-500 hover:text-ink-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Sort exercises by module"
              title={
                alreadySorted
                  ? 'Already in module order'
                  : 'Sort by module (SMR → Mobility → Activation → Strength → Balance → Rev Up)'
              }
            >
              <ArrowDownAZ size={13} />
            </button>
          )}
          <button
            onClick={() => onDuplicate(day.id)}
            disabled={isPending || atCap}
            className="text-ink-500 hover:text-ink-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Duplicate this day"
            title={atCap ? `Routine is at the ${MAX_ROUTINE_DAYS}-day cap` : 'Duplicate this day'}
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => onRemove(day.id)}
            disabled={isPending}
            className="text-ink-500 hover:text-bad transition"
            aria-label="Remove day"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        {scheduleStyle === 'weekday' && (
          <WeekdayPicker
            value={day.weekday}
            takenWeekdays={takenWeekdays}
            onChange={(wd) => onSetWeekday(day.id, wd)}
            disabled={isPending}
          />
        )}
        {scheduleStyle === 'sequence' && allDays.length > 1 && (
          <SequencePositionPicker
            currentId={day.id}
            allDays={allDays}
            onSwap={(targetId) => onSwapPositions(day.id, targetId)}
            disabled={isPending}
          />
        )}

        {/* Day-level description. Collapsed by default; click "+ Add note for
            this day" to expand. When populated, shows the full text (italic,
            dimmed) and tapping reopens the editor. */}
        {descOpen ? (
          <div className="space-y-1">
            <textarea
              value={descText}
              onChange={(e) => setDescText(e.target.value)}
              onBlur={() => {
                commitDescription();
                setDescOpen(false);
              }}
              autoFocus
              rows={3}
              placeholder="Frame the day — e.g. Lower emphasis (glute drive), stack ~60 min: SMR → Mobility → Activation → Strength → Rev Up."
              disabled={isPending}
              className="block w-full bg-ink-950 border border-ink-800 rounded px-2 py-1.5 text-[12px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-accent/50 resize-none"
            />
            {/* Hover/tap the icon to learn what each module in the suggested
                stack actually means — beginners shouldn't have to guess SMR. */}
            <div className="text-[10px] text-ink-600 inline-flex items-center gap-1">
              <InfoTooltip label="Module sequence" size={11} align="start">
                {ExplainModuleSequence}
              </InfoTooltip>
              What are SMR / Mobility / Activation / Rev Up?
            </div>
          </div>
        ) : descHasContent ? (
          <button
            type="button"
            onClick={() => setDescOpen(true)}
            className="block w-full text-left text-[11px] text-ink-400 italic font-display whitespace-pre-wrap break-words leading-snug hover:text-ink-100 transition"
          >
            {day.description}
          </button>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDescOpen(true)}
              disabled={isPending}
              className="text-[11px] text-ink-500 italic font-display hover:text-ink-300 transition disabled:opacity-50"
            >
              + Add a note for this day
            </button>
            <InfoTooltip label="Day note" size={11} align="start">
              {ExplainDayDescription}
            </InfoTooltip>
          </div>
        )}

        {day.exercises.length > 0 && (
          <PerDayCoverageStrip
            day={day}
            muscleGroups={muscleGroups}
            exerciseById={exerciseById}
            routineTotals={routineTotals}
          />
        )}

        {day.exercises.length > 0 ? (
          <div className="space-y-3">
            {moduleGroups.map((group, groupIdx) => {
              const subtotalSec = groupEstimateSec.get(group.module) ?? 0;
              return (
                <div
                  key={group.module}
                  className={`space-y-1 ${
                    groupIdx > 0 ? 'pt-2 border-t border-ink-800/60' : ''
                  }`}
                >
                  <div className="flex items-baseline gap-2 px-0.5">
                    <div className="text-[11px] tracking-[0.22em] uppercase text-ink-200 font-medium inline-flex items-center gap-1">
                      <span>{group.module}</span>
                      <ModuleInfoTooltip module={group.module} />
                    </div>
                    {subtotalSec > 0 && (
                      <div className="text-[10px] text-ink-500 font-mono">
                        ~{formatEstimateCompact(subtotalSec)}
                      </div>
                    )}
                  </div>
                  {group.exercises.map((ex) => {
                    // Position-order index lookup so move-up/down logic stays in
                    // step with the underlying data even when modules interleave.
                    const dataIdx = day.exercises.findIndex((e) => e.exerciseId === ex.exerciseId);
                    const prev = dataIdx > 0 ? day.exercises[dataIdx - 1] : null;
                    const next =
                      dataIdx >= 0 && dataIdx < day.exercises.length - 1
                        ? day.exercises[dataIdx + 1]
                        : null;
                    // Disable across-module swaps so move-up/down in the grouped
                    // view never visually jumps an exercise out of its header.
                    // Sort handles cross-module cleanup in one shot.
                    const canMoveUp = prev !== null && prev.module === ex.module;
                    const canMoveDown = next !== null && next.module === ex.module;
                    return (
                      <ExerciseRow
                        key={ex.exerciseId}
                        exercise={ex}
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        isPending={isPending}
                        onRemove={() => onRemoveExercise(day.id, ex.exerciseId)}
                        onMove={(dir) => onReorderExercise(day.id, ex.exerciseId, dir)}
                        onUpdatePlanned={(patch) =>
                          onUpdateExercisePlanned(day.id, ex.exerciseId, patch)
                        }
                        onSwap={onSwapExercise ? () => onSwapExercise(day.id, ex.exerciseId) : null}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-ink-500 italic font-display py-1">No exercises yet.</p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenExercisePicker(day.id)}
            disabled={isPending}
            className="flex-1 border border-dashed border-ink-700 rounded-lg py-2 text-xs text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Plus size={12} />
            {day.exercises.length === 0 ? 'Pick exercises' : 'Add more'}
          </button>
          {day.exercises.length === 0 && seedTemplates.length > 0 && (
            <SeedFromTemplateMenu
              seedTemplates={seedTemplates}
              disabled={isPending}
              onPick={(templateId) => onSeedFromTemplate(day.id, templateId)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SeedFromTemplateMenu({
  seedTemplates,
  disabled,
  onPick,
}: {
  seedTemplates: SeedTemplateClient[];
  disabled: boolean;
  onPick: (templateId: string) => void;
}) {
  // Plain native <select> styled to match. Triggering a value change picks
  // a seed and resets back to the placeholder so the same template can be
  // re-picked on a future empty day.
  return (
    <select
      value=""
      disabled={disabled}
      onChange={(e) => {
        const id = e.target.value;
        if (id) onPick(id);
        e.currentTarget.value = '';
      }}
      className="bg-ink-900 border border-dashed border-ink-700 rounded-lg px-2 py-2 text-xs text-ink-300 hover:border-accent/50 transition focus:outline-none disabled:opacity-50 max-w-[40%]"
    >
      <option value="">Or seed from…</option>
      {seedTemplates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({t.exerciseNames.length}){t.isBuiltin ? ' · default' : ''}
        </option>
      ))}
    </select>
  );
}

// Tiny pill that sits at the start of every day-card header. The user
// originally couldn't tell where one day ended and the next began in cycle
// mode — this badge plus the (kept) up/down controls and the new cycle
// position grid below make day boundaries obvious. In weekday mode it
// shows the weekday name; in cycle mode it shows "Day N".
function DayPositionBadge({
  scheduleStyle,
  position,
  weekday,
}: {
  scheduleStyle: ScheduleStyle;
  position: number;
  weekday: number | null;
}) {
  const label =
    scheduleStyle === 'weekday'
      ? weekday !== null
        ? WEEKDAY_FULL_LABELS[weekday]
        : 'Unpinned'
      : `Day ${position}`;
  return (
    <span
      className="text-[10px] tracking-[0.2em] uppercase font-mono accent-text bg-accent/10 border border-accent/30 rounded-full px-2 py-0.5 shrink-0"
      aria-label={`Routine ${label}`}
    >
      {label}
    </span>
  );
}

// Cycle-mode-only sibling of WeekdayPicker. Renders one button per existing
// day in the routine. Tapping the current day's chip is a no-op (visual
// "you are here"); tapping another chip swaps positions with that day in a
// single click. The cap is MAX_ROUTINE_DAYS so this comfortably fits in a
// single row.
function SequencePositionPicker({
  currentId,
  allDays,
  onSwap,
  disabled,
}: {
  currentId: string;
  allDays: { id: string }[];
  onSwap: (targetId: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1.5">
        Position — tap to swap
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {allDays.map((d, i) => {
          const isMine = d.id === currentId;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => (isMine ? undefined : onSwap(d.id))}
              disabled={disabled || isMine}
              aria-label={isMine ? `This day is Day ${i + 1}` : `Swap to Day ${i + 1}`}
              aria-current={isMine}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition ${
                isMine
                  ? 'accent-bg text-ink-950 border-transparent cursor-default'
                  : 'border-ink-800 text-ink-300 hover:border-ink-600'
              }`}
            >
              Day {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekdayPicker({
  value,
  takenWeekdays,
  onChange,
  disabled,
}: {
  value: number | null;
  takenWeekdays: Set<number>;
  onChange: (wd: number | null) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1.5">Weekday</div>
      <div className="flex gap-1.5 flex-wrap">
        {WEEKDAY_LABELS.map((wd, i) => {
          const isMine = value === i;
          const taken = takenWeekdays.has(i) && !isMine;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(isMine ? null : i)}
              disabled={disabled || taken}
              aria-label={WEEKDAY_FULL_LABELS[i]}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition ${
                isMine
                  ? 'accent-bg text-ink-950 border-transparent'
                  : taken
                    ? 'bg-ink-900/60 text-ink-700 border-ink-900 cursor-not-allowed'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600'
              }`}
            >
              {wd}
            </button>
          );
        })}
        {value === null && (
          <span className="text-[10px] text-ink-500 italic font-display self-center ml-1">
            unpinned
          </span>
        )}
      </div>
    </div>
  );
}

function ExerciseRow({
  exercise,
  canMoveUp,
  canMoveDown,
  isPending,
  onSwap,
  onRemove,
  onMove,
  onUpdatePlanned,
}: {
  exercise: DayExercise;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isPending: boolean;
  onSwap: (() => void) | null;
  onRemove: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onUpdatePlanned: (patch: PlannedPatch) => void;
}) {
  // Note editing follows the same commit-on-blur pattern as PlannedInputs:
  // local string state while focused, commit when the textarea loses focus,
  // sync from upstream only when not actively editing so a server-side
  // revalidation doesn't yank text mid-type. Empty (trimmed) clears the
  // column to null via the action's RoutineExerciseNoteSchema.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(exercise.note ?? '');
  useEffect(() => {
    if (!noteOpen) setNoteText(exercise.note ?? '');
  }, [exercise.note, noteOpen]);

  const noteHasContent = (exercise.note ?? '').trim().length > 0;

  function commitNote() {
    const trimmed = noteText.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next !== exercise.note) onUpdatePlanned({ note: next });
  }

  const region = regionForExercise(exercise);
  const regionStyles = REGION_STYLES[region];

  return (
    <div
      className={`bg-ink-900/40 border border-ink-900 ${regionStyles.leftBorderThick} rounded px-2.5 py-2`}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={() => onMove('up')}
            disabled={!canMoveUp || isPending}
            className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            aria-label="Move exercise up"
          >
            <ChevronUp size={11} />
          </button>
          <button
            onClick={() => onMove('down')}
            disabled={!canMoveDown || isPending}
            className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            aria-label="Move exercise down"
          >
            <ChevronDown size={11} />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-ink-100 truncate flex items-center gap-1.5">
            <span className="truncate">{exercise.name}</span>
            <VideoLink url={exercise.videoUrl} exerciseName={exercise.name} size={12} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[10px] text-ink-500 truncate inline-flex items-center gap-1">
              <span>{exercise.module}</span>
              <ModuleInfoTooltip module={exercise.module} size={10} />
            </div>
            <EquipmentChips equipment={exercise.equipment} />
          </div>
        </div>
        <PlannedInputs
          metric={exercise.metric}
          plannedSets={exercise.plannedSets}
          plannedReps={exercise.plannedReps}
          plannedSeconds={exercise.plannedSeconds}
          disabled={isPending}
          onChange={onUpdatePlanned}
        />
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          disabled={isPending}
          aria-label={
            noteHasContent ? `Edit note for ${exercise.name}` : `Add note for ${exercise.name}`
          }
          aria-expanded={noteOpen}
          title={noteHasContent ? 'Edit note' : 'Add a note'}
          className={`transition disabled:opacity-50 shrink-0 ${
            noteHasContent ? 'accent-text hover:brightness-110' : 'text-ink-500 hover:text-ink-100'
          }`}
        >
          <StickyNote size={13} />
        </button>
        {onSwap && (
          <button
            onClick={onSwap}
            disabled={isPending}
            className="text-ink-500 hover:text-ink-100 transition disabled:opacity-50 shrink-0"
            aria-label={`Swap ${exercise.name}`}
          >
            <Replace size={13} />
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={isPending}
          className="text-ink-500 hover:text-bad transition disabled:opacity-50 shrink-0"
          aria-label={`Remove ${exercise.name}`}
        >
          <X size={13} />
        </button>
      </div>

      {/* Collapsed preview — only when there's a note and the editor isn't open.
          Tapping the preview reopens the editor so the user doesn't have to
          aim at the small icon. */}
      {!noteOpen && noteHasContent && (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="block w-full text-left mt-1 pl-[18px] text-[10px] text-ink-400 italic font-display truncate hover:text-ink-100 transition"
        >
          {exercise.note}
        </button>
      )}

      {/* Inline editor. Auto-focuses on open; commits and collapses on blur. */}
      {noteOpen && (
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => {
            commitNote();
            setNoteOpen(false);
          }}
          autoFocus
          rows={3}
          placeholder="Tempo, breathing, cues — anything you want to see while lifting."
          disabled={isPending}
          className="block w-full mt-1.5 bg-ink-950 border border-ink-800 rounded px-2 py-1.5 text-[12px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-accent/50 resize-none"
        />
      )}
    </div>
  );
}

// Tiny pair of inputs for plannedSets × (plannedReps | plannedSeconds). All
// optional — empty means "not set," which lets the seed flow fall back to
// history / prescription / preference. We keep edits in local state and commit
// on blur so the user can tap-and-type without each keystroke firing a server
// action. Bounds match the action-side Zod schemas; out-of-range values are
// clamped rather than rejected so a stray fat-finger doesn't drop the whole
// edit.
//
// Whether the second input is "reps" or "seconds" depends on the exercise's
// `metric`. Time-metric exercises (planks, holds, carries) flip to a seconds
// input with an `s` separator and a wider bound (3600s = one hour).
function PlannedInputs({
  metric,
  plannedSets,
  plannedReps,
  plannedSeconds,
  disabled,
  onChange,
}: {
  metric: string;
  plannedSets: number | null;
  plannedReps: number | null;
  plannedSeconds: number | null;
  disabled: boolean;
  onChange: (patch: PlannedPatch) => void;
}) {
  const isTime = metric === 'time';
  const secondaryValue = isTime ? plannedSeconds : plannedReps;
  const secondaryMax = isTime ? 3600 : 100;
  const secondaryLabel = isTime ? 'Planned seconds' : 'Planned reps';

  const [setsText, setSetsText] = useState(plannedSets?.toString() ?? '');
  const [secondaryText, setSecondaryText] = useState(secondaryValue?.toString() ?? '');

  useEffect(() => {
    setSetsText(plannedSets?.toString() ?? '');
  }, [plannedSets]);
  useEffect(() => {
    setSecondaryText(secondaryValue?.toString() ?? '');
  }, [secondaryValue]);

  function commit(field: 'sets' | 'secondary', text: string) {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (field === 'sets' && plannedSets !== null) onChange({ plannedSets: null });
      if (field === 'secondary' && secondaryValue !== null) {
        onChange(isTime ? { plannedSeconds: null } : { plannedReps: null });
      }
      return;
    }
    const n = parseInt(trimmed, 10);
    if (Number.isNaN(n)) {
      if (field === 'sets') setSetsText(plannedSets?.toString() ?? '');
      else setSecondaryText(secondaryValue?.toString() ?? '');
      return;
    }
    if (field === 'sets') {
      const clamped = Math.max(1, Math.min(20, n));
      if (clamped !== plannedSets) onChange({ plannedSets: clamped });
      setSetsText(clamped.toString());
    } else {
      const clamped = Math.max(1, Math.min(secondaryMax, n));
      if (clamped !== secondaryValue) {
        onChange(isTime ? { plannedSeconds: clamped } : { plannedReps: clamped });
      }
      setSecondaryText(clamped.toString());
    }
  }

  const inputClass =
    'bg-ink-950 border border-ink-800 rounded text-[11px] text-ink-100 text-center font-mono py-1 px-1 focus:outline-none focus:border-accent/50 disabled:opacity-50';

  return (
    <div className="flex items-center gap-1 shrink-0 text-ink-500 text-[10px] font-mono">
      <input
        type="text"
        inputMode="numeric"
        value={setsText}
        onChange={(e) => setSetsText(e.target.value)}
        onBlur={(e) => commit('sets', e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setSetsText(plannedSets?.toString() ?? '');
            e.currentTarget.blur();
          }
        }}
        disabled={disabled}
        placeholder="—"
        aria-label="Planned sets"
        className={`${inputClass} w-9`}
      />
      <span aria-hidden="true">×</span>
      <input
        type="text"
        inputMode="numeric"
        value={secondaryText}
        onChange={(e) => setSecondaryText(e.target.value)}
        onBlur={(e) => commit('secondary', e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setSecondaryText(secondaryValue?.toString() ?? '');
            e.currentTarget.blur();
          }
        }}
        disabled={disabled}
        placeholder="—"
        aria-label={secondaryLabel}
        className={`${inputClass} ${isTime ? 'w-12' : 'w-9'}`}
      />
      {isTime && (
        <span className="text-ink-600" aria-hidden="true">
          s
        </span>
      )}
    </div>
  );
}

// ============ STRUCTURAL COVERAGE COMPUTATION ============
//
// A *structural* coverage view: given the days you've laid out, how many
// weighted sets per muscle does the routine deliver across one full cycle?
// Distinct from /coverage, which shows recency from completed sessions —
// here we're answering "is the plan I'm building balanced?", not "what have
// I worked recently?"
//
// Volume math and tier logic live in lib/coverage.ts (imported above) so the
// /coverage page, share view, and suggestion-diff preview all agree on what
// "meets target" and "below minimum" mean. We adapt the editor's day shape
// to the shared PlannedDay shape here.

type MuscleTotal = MuscleVolume;
type MuscleTotals = MuscleVolumes;

function computeMuscleTotals(
  days: EditorDay[],
  exerciseById: Map<string, ExerciseInfo>,
): { totals: MuscleTotals; anyEstimated: boolean } {
  return computeRoutineVolumes(
    days.map((d) => ({
      exercises: d.exercises.map((dx) => ({
        exerciseId: dx.exerciseId,
        plannedSets: dx.plannedSets,
      })),
    })),
    exerciseById,
  );
}

// Bounds adapter: muscle group → { min, target } for tierFor. Returns null
// when the muscle isn't tracked by volume (mobility / balance / cardio).
function boundsFor(m: MuscleGroupClient): { min: number; target: number } | null {
  if (m.target === null || m.target === 0) return null;
  return { min: m.min ?? Math.round(m.target * 0.5), target: m.target };
}

function tierFor(sets: number, m: MuscleGroupClient): CoverageTier {
  return coverageTierFor(sets, boundsFor(m));
}

// The set of muscle ids the routine is currently *short* on — has a target,
// and the planned sets are below it. Drives the picker's gap-filling
// highlight. "Untracked" muscles never enter this set: there's no target to
// be short of. "Emphasis" doesn't either — extra work isn't a gap.
function gapMusclesFromTotals(
  totals: MuscleTotals,
  muscleGroups: MuscleGroupClient[],
): Set<string> {
  const out = new Set<string>();
  for (const m of muscleGroups) {
    const b = boundsFor(m);
    if (b === null) continue;
    const sets = totals.get(m.id)?.sets ?? 0;
    const t = coverageTierFor(sets, b);
    if (t === 'under' || t === 'gap') out.add(m.id);
  }
  return out;
}

// ============ PER-DAY COVERAGE STRIP ============
//
// One compact line per day showing what muscles the day hits and at what
// volume. Each muscle pill is coloured by its *weekly* coverage tier (so the
// user can see at a glance whether this day is contributing to a muscle that's
// already on target vs one that's a gap). Top 6 muscles by day-local sets, so
// the strip stays scannable on a 4-exercise day or a 12-exercise one.

function PerDayCoverageStrip({
  day,
  muscleGroups,
  exerciseById,
  routineTotals,
}: {
  day: EditorDay;
  muscleGroups: MuscleGroupClient[];
  exerciseById: Map<string, ExerciseInfo>;
  routineTotals: MuscleTotals;
}) {
  const top = useMemo(() => {
    const { totals } = computeDayVolumes(
      {
        exercises: day.exercises.map((dx) => ({
          exerciseId: dx.exerciseId,
          plannedSets: dx.plannedSets,
        })),
      },
      exerciseById,
    );
    const byId = new Map(muscleGroups.map((m) => [m.id, m]));
    const rows: { id: string; label: string; sets: number; tier: CoverageTier }[] = [];
    for (const [muscleId, vol] of totals) {
      if (vol.sets <= 0) continue;
      const m = byId.get(muscleId);
      if (!m) continue;
      const weeklyTier = tierFor(routineTotals.get(muscleId)?.sets ?? 0, m);
      rows.push({ id: muscleId, label: m.label, sets: vol.sets, tier: weeklyTier });
    }
    // Sort by sets desc so the muscles this day actually emphasizes lead.
    rows.sort((a, b) => b.sets - a.sets);
    return rows.slice(0, 6);
  }, [day, muscleGroups, exerciseById, routineTotals]);

  if (top.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap py-0.5">
      <span
        className="text-[9px] tracking-[0.2em] uppercase text-ink-600 shrink-0 mr-0.5"
        title="What this day hits, coloured by the muscle's weekly coverage tier."
      >
        Hits
      </span>
      {top.map((m) => {
        const tok = TIER_VISUALS[m.tier];
        return (
          <span
            key={m.id}
            className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border"
            style={{ background: tok.bg, borderColor: tok.border }}
            title={`${m.label}: ${formatSets(m.sets)} sets this day · weekly tier: ${tok.label}`}
          >
            <span
              className="w-1 h-1 rounded-full shrink-0"
              style={{ background: tok.dot }}
              aria-hidden="true"
            />
            <span className="text-ink-200">{m.label}</span>
            <span className="text-ink-500">{formatSets(m.sets)}</span>
          </span>
        );
      })}
    </div>
  );
}

// ============ COVERAGE PANEL ============

function CoveragePanel({
  totals,
  anyEstimated,
  muscleGroups,
}: {
  totals: MuscleTotals;
  anyEstimated: boolean;
  muscleGroups: MuscleGroupClient[];
}) {
  // Group muscles into the same buckets the /coverage view uses, in display
  // order, so the visual mapping is consistent.
  const byCategory = useMemo(() => {
    const groups = new Map<MuscleGroupClient['category'], MuscleGroupClient[]>();
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

  // Headline counts for the summary line. Untracked muscles are excluded
  // from the denominator — they aren't graded.
  const summary = useMemo(() => {
    let onTarget = 0;
    let ok = 0;
    let under = 0;
    let gap = 0;
    let emphasis = 0;
    let trackedTotal = 0;
    for (const m of muscleGroups) {
      const b = boundsFor(m);
      if (b === null) continue;
      trackedTotal++;
      const sets = totals.get(m.id)?.sets ?? 0;
      const t = coverageTierFor(sets, b);
      if (t === 'target') onTarget++;
      else if (t === 'ok') ok++;
      else if (t === 'under') under++;
      else if (t === 'gap') gap++;
      else if (t === 'emphasis') emphasis++;
    }
    return { target: onTarget, ok, under, gap, emphasis, trackedTotal };
  }, [totals, muscleGroups]);

  const hasAnything = totals.size > 0;

  return (
    <section className="mt-6 border border-ink-800 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div>
          <h2 className="text-sm text-ink-100">Coverage</h2>
          <p className="text-[11px] text-ink-500 italic font-display mt-0.5 leading-relaxed">
            What this routine hits across one full cycle.
            {anyEstimated && (
              <> Exercises without planned sets are estimated at {ESTIMATED_SETS_FALLBACK}.</>
            )}
          </p>
        </div>
      </div>

      {!hasAnything && (
        <p className="text-[11px] text-ink-500 italic font-display py-2">
          Add some exercises and the muscle map fills in here.
        </p>
      )}

      {hasAnything && (
        <>
          <SummaryStrip summary={summary} />
          <CoverageLegend />
          <div className="space-y-4 mt-3">
            {Array.from(byCategory.entries()).map(([category, items]) => (
              <CoverageCategory key={category} category={category} items={items} totals={totals} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// Collapsible legend that explains the tier colors and the philosophy of why
// smaller-target muscles aren't "less important". Defaults closed so the panel
// stays compact for return users; the question is mostly a first-look concern.
function CoverageLegend() {
  return (
    <details className="mt-2 group">
      <summary className="text-[10px] text-ink-500 italic font-display cursor-pointer select-none hover:text-ink-300 transition list-none flex items-center gap-1">
        <span className="text-ink-600 group-open:rotate-90 transition-transform inline-block w-2">
          ›
        </span>
        What do these colors mean?
      </summary>
      <div className="mt-2 mb-1 pl-3 border-l border-ink-800 space-y-1.5 text-[11px] text-ink-300 leading-relaxed">
        <LegendRow tier="target" label="On target">
          Weekly sets meet or exceed the target. The stretch goal — solid week.
        </LegendRow>
        <LegendRow tier="ok" label="Good">
          Above the minimum but below the target. A solid maintenance dose for most lifters;
          push higher only if growth is the goal.
        </LegendRow>
        <LegendRow tier="under" label="Below min">
          Some work is happening, but less than the floor. Worth adding a set or two — even a
          postural muscle benefits from getting past the minimum.
        </LegendRow>
        <LegendRow tier="gap" label="Gap">
          Zero sets across the cycle on a muscle that has a target. Worth a deliberate choice —
          either tag-fill (add an exercise) or override the target down.
        </LegendRow>
        <LegendRow tier="emphasis" label="Emphasis">
          Well above target. Not a problem — flagged in case you wanted balanced coverage and
          this slipped past. Often intentional (specialization, lagging part).
        </LegendRow>
        <LegendRow tier="untracked" label="Untracked">
          Mobility, balance, and cardio rows. Tracked by recency on the Coverage page, not weekly
          volume — once or twice a week is plenty.
        </LegendRow>
        <p className="text-[10px] italic text-ink-500 pt-1">
          A smaller target (like Lower traps at 6 or Adductors at 4) doesn’t mean the muscle is less
          important — it’s a small/postural muscle that gets a lot of secondary credit from the main
          lifts, so less direct work is needed. Tier and per-muscle overrides live in Settings.
        </p>
      </div>
    </details>
  );
}

function LegendRow({
  tier,
  label,
  children,
}: {
  tier: CoverageTier;
  label: string;
  children: React.ReactNode;
}) {
  const tok = TIER_VISUALS[tier];
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
        style={{ background: tok.dot }}
        aria-hidden="true"
      />
      <div className="flex-1">
        <span className="text-ink-100 font-medium">{label}.</span>{' '}
        <span className="text-ink-400">{children}</span>
      </div>
    </div>
  );
}

function SummaryStrip({
  summary,
}: {
  summary: { target: number; ok: number; under: number; gap: number; emphasis: number };
}) {
  // Small chips. Hidden when nothing falls into a tier, so the strip
  // collapses cleanly when the routine is fully built or fully empty.
  const items = (
    [
      { tier: 'target', label: 'on target', count: summary.target },
      { tier: 'ok', label: 'good', count: summary.ok },
      { tier: 'under', label: 'below min', count: summary.under },
      { tier: 'gap', label: 'gap', count: summary.gap },
      { tier: 'emphasis', label: 'emphasis', count: summary.emphasis },
    ] satisfies { tier: CoverageTier; label: string; count: number }[]
  ).filter((i) => i.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((i) => {
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
  );
}

const CATEGORY_LABEL: Record<MuscleGroupClient['category'], string> = {
  lower: 'Lower body',
  upper: 'Upper body',
  trunk: 'Core & trunk',
  mobility: 'Mobility',
  other: 'Other',
};

function CoverageCategory({
  category,
  items,
  totals,
}: {
  category: MuscleGroupClient['category'];
  items: MuscleGroupClient[];
  totals: MuscleTotals;
}) {
  // Category-level rollup: dominant tier wins. gap > under > emphasis > ok >
  // target > untracked — so a single under-trained muscle in a category dot's
  // the heading red rather than hiding behind the other rows.
  const heading = useMemo(() => {
    let dominant: CoverageTier = 'untracked';
    const order: Record<CoverageTier, number> = {
      gap: 5,
      under: 4,
      emphasis: 3,
      ok: 2,
      target: 1,
      untracked: 0,
    };
    for (const m of items) {
      const sets = totals.get(m.id)?.sets ?? 0;
      const t = tierFor(sets, m);
      if (order[t] > order[dominant]) dominant = t;
    }
    return dominant;
  }, [items, totals]);

  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1.5 flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: TIER_VISUALS[heading].dot }}
          aria-hidden="true"
        />
        {CATEGORY_LABEL[category]}
      </div>
      <div className="space-y-1">
        {items.map((m) => {
          const total = totals.get(m.id);
          return <CoverageRow key={m.id} muscle={m} total={total} />;
        })}
      </div>
    </div>
  );
}

function CoverageRow({
  muscle,
  total,
}: {
  muscle: MuscleGroupClient;
  total: MuscleTotal | undefined;
}) {
  const sets = total?.sets ?? 0;
  const target = muscle.target;
  const min = muscle.min;
  const hasTarget = target !== null && target > 0;
  // Cap at target — "100% bar" means "hit target". Emphasis lifts the bar to
  // 100% tinted blue so the user sees a saturated bar in that case too.
  const ratio = hasTarget ? Math.min(sets / target, 1) : 0;
  const minRatio = hasTarget && min !== null && min > 0 ? Math.min(min / target, 1) : 0;
  const tier = tierFor(sets, muscle);
  const tok = TIER_VISUALS[tier];

  const tooltip = muscle.description
    ? `${muscle.label} — ${muscle.description}`
    : muscle.label;

  return (
    <div
      className="border rounded px-2.5 py-1.5 flex items-center gap-3"
      style={{ background: tok.bg, borderColor: tok.border }}
      title={tooltip}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: tok.dot }}
        aria-hidden="true"
      />
      <span className="text-[12px] text-ink-100 truncate flex-1 min-w-0 decoration-dotted decoration-ink-700 underline-offset-[3px] hover:underline">
        {muscle.label}
      </span>

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
                title={`Minimum: ${min} sets`}
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-ink-400 shrink-0 w-16 text-right">
            {formatSets(sets)}/{muscle.target}
            {total?.estimated && <span className="text-ink-600 ml-0.5">?</span>}
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

// ============ DANGER ZONE (Live mode) ============

type ConfirmFn = ReturnType<typeof useConfirm>['confirm'];

function DangerZone({
  routineName,
  isPending,
  startTransition,
  confirm,
}: {
  routineName: string;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
  confirm: ConfirmFn;
}) {
  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${routineName}"?`,
      message:
        'This drops the routine and the per-day exercise lists it owned. Your other templates and session history are unaffected.',
      confirmLabel: 'Delete routine',
      variant: 'danger',
    });
    if (!ok) return;
    startTransition(() => {
      deleteRoutine();
    });
  }

  return (
    <div className="border border-ink-900 rounded-lg p-4 flex items-center justify-between gap-3 mt-6">
      <div>
        <div className="text-sm text-ink-100">Delete this routine</div>
        <div className="text-[11px] text-ink-500 italic font-display mt-0.5">
          Other templates and session history are unaffected.
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={isPending}
        className="text-xs tracking-wider uppercase text-ink-500 hover:text-bad transition disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
