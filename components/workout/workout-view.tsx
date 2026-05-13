'use client';

// The interactive workout tracker.
// Receives initial data from the server, calls server actions for every mutation.
// Uses isPending from useTransition to disable buttons during in-flight actions
// (prevents double-submit) and useConfirm for on-brand confirmation dialogs.

import { useState, useTransition, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Check, Calendar, Clock, Trash2, BookmarkPlus, ArrowRight } from 'lucide-react';
import {
  estimateActiveSession,
  estimatePlannedTotalSeconds,
  formatEstimate,
} from '@/lib/time-estimate';
import {
  addExercisesToActiveSession,
  removeExerciseFromActiveSession,
  addSet,
  updateSet,
  updateSetNotes,
  removeSet,
  completeActiveSession,
  discardActiveSession,
  createCustomExercise,
  deleteCustomExercise,
  reorderExercise,
  setExerciseRestOverride,
  saveActiveAsTemplate,
  startFromTemplate,
  deleteTemplate,
  hideTemplate,
  swapExerciseInActiveSession,
  setExerciseWeightIncrement,
  repeatLastForExercise,
} from '@/lib/actions';
import { ExerciseInSession } from './exercise-in-session';
import { ExercisePicker } from './exercise-picker';
import { RestTimerBar, useRestTimer } from './rest-timer';
import { useConfirm } from '@/components/ui/use-confirm';
import { usePrefs } from '@/components/ui/prefs-context';
import { groupBy, relativeDay } from '@/lib/utils';
import { muscleIdsToChipIds } from '@/lib/area-filter';
import { moduleDescription } from '@/lib/exercises-data';
import { RoutineTimeline, type RoutineTimelineProps } from '@/components/routines/routine-timeline';

// ============ TYPES ============

export type ExerciseInfo = {
  id: string;
  name: string;
  module: string;
  prescription: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  videoUrl: string | null;
  isCustom: boolean;
  // 'reps' (the default) or 'time'. Determines which input the set row renders.
  metric: string;
  // 'weight' (the default), 'band', or 'none'. Determines whether the set row
  // shows a numeric weight stepper, a band-strength chip selector, or hides
  // the load column entirely. See Exercise.loadType in schema.prisma.
  loadType: string;
  // Equipment tokens. Used by the routine preset picker; the active session UI
  // doesn't filter on it.
  equipment: string[];
  // Per-user rest timer override; null = use the global default from preferences
  restTimerSecondsOverride: number | null;
  // Per-user weight stepper override; null = use the global default
  weightIncrementOverride: number | null;
};

export type SetLogClient = {
  id: string;
  exerciseId: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  // Populated when the source Exercise.metric is 'time'. Mutually exclusive
  // with reps in normal use, but the schema doesn't enforce that.
  seconds: number | null;
  // Populated when the source Exercise.loadType is 'band'. The band name is
  // resolved against the user's BandsEditor list and surfaced in last-time
  // refs ("Last today: 12×medium"). Mutually exclusive with weight in normal
  // use; the writing actions clear one when setting the other.
  bandId: string | null;
  notes: string | null;
};

export type ActiveSessionClient = {
  id: string;
  date: string; // ISO
  setLogs: SetLogClient[];
};

export type LastSetsForExercise = {
  exerciseId: string;
  sessionDate: string; // ISO
  sets: {
    setNumber: number;
    reps: number | null;
    weight: number | null;
    seconds: number | null;
    bandId: string | null;
    notes: string | null;
  }[];
};

export type TemplateClient = {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  exerciseCount: number;
  // Names of the first few exercises, for preview
  previewNames: string[];
  // Planned dimensions per exercise, in display order. Drives the time
  // estimate shown alongside the template in the empty state. Metric and
  // rest overrides are resolved at render time against availableExercises
  // and the user's prefs, so this only carries data unique to the template.
  plannedExercises: {
    exerciseId: string;
    plannedSets: number | null;
    plannedReps: number | null;
    plannedSeconds: number | null;
  }[];
  updatedAt: string; // ISO
};

type Props = {
  activeSession: ActiveSessionClient | null;
  availableExercises: ExerciseInfo[];
  lastSets: LastSetsForExercise[];
  // The user's bands list. Drives the band chip-picker for exercises with
  // loadType='band'. Server-loaded so it's stable across re-renders.
  bands: { id: string; name: string; position: number }[];
  // Per-exercise notes lifted from the routine-day the active session was
  // started from (if any). Read-only at the session level; the user edits
  // them on the routine editor page. Empty array when there's no active
  // session or it wasn't started from a routine.
  routineExerciseNotes: { exerciseId: string; note: string }[];
  templates: TemplateClient[];
  // Null when the user hasn't created a routine. Otherwise drives the
  // timeline panel above the empty state.
  routine: Omit<RoutineTimelineProps, 'availableExercises'> | null;
};

// ============ COMPONENT ============

export function WorkoutView({
  activeSession,
  availableExercises,
  lastSets,
  bands,
  routineExerciseNotes,
  templates,
  routine,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Chip selection from the empty state. Carries through into the picker so a
  // user who tapped [Chest] on the home screen sees the picker pre-filtered.
  // Cleared after the picker closes to avoid surprising mid-session reopens.
  const [pendingRegionIds, setPendingRegionIds] = useState<string[]>([]);
  const [pendingMuscleChipIds, setPendingMuscleChipIds] = useState<string[]>([]);
  // When set, the picker is in swap mode — picking an exercise replaces the
  // named one in place rather than adding to the session. Cleared on close.
  const [swapTarget, setSwapTarget] = useState<{
    exerciseId: string;
    exerciseName: string;
  } | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const { prefs, updatePrefs } = usePrefs();
  const restTimer = useRestTimer(prefs);

  // ============ PREFERENCE TOGGLES (from rest timer bar) ============
  // Shared context handles the optimistic update + persistence.
  const toggleSound = () => updatePrefs({ restTimerSound: !prefs.restTimerSound });
  const toggleVibrate = () => updatePrefs({ restTimerVibrate: !prefs.restTimerVibrate });

  // Quick lookups — memoized so they aren't rebuilt on unrelated state changes
  // (picker open, transition pending, save-template dialog, etc.). With dozens
  // of exercises this avoids a small but real allocation churn each render.
  const exerciseById = useMemo(
    () => new Map(availableExercises.map((e) => [e.id, e])),
    [availableExercises],
  );
  const lastByExercise = useMemo(() => new Map(lastSets.map((l) => [l.exerciseId, l])), [lastSets]);
  const routineNoteByExercise = useMemo(
    () => new Map(routineExerciseNotes.map((n) => [n.exerciseId, n.note])),
    [routineExerciseNotes],
  );

  // Group active session's setLogs by exerciseId, preserving first-appearance
  // order. Use a Set for the seen-check so we stay O(n) — `Array.includes`
  // inside the loop was O(n²) for sessions with many exercises.
  const { setLogsByExercise, exerciseOrderInSession } = useMemo(() => {
    const setLogs = activeSession?.setLogs ?? [];
    const byExercise = groupBy(setLogs, (s) => s.exerciseId);
    const seen = new Set<string>();
    const order: string[] = [];
    for (const set of setLogs) {
      if (!seen.has(set.exerciseId)) {
        seen.add(set.exerciseId);
        order.push(set.exerciseId);
      }
    }
    return { setLogsByExercise: byExercise, exerciseOrderInSession: order };
  }, [activeSession?.setLogs]);

  const exerciseIdsAlreadyInSession = useMemo(
    () => new Set(exerciseOrderInSession),
    [exerciseOrderInSession],
  );
  const sessionStarted = activeSession !== null && exerciseOrderInSession.length > 0;

  // Active-session time estimate. Walks the exercises in their session order
  // so the rest-after-last-set subtraction lands on the right exercise's rest
  // value. Filled set logs use their actual reps/seconds for working time;
  // unfilled rows fall back to the estimator's defaults.
  const sessionEstimate = sessionStarted
    ? estimateActiveSession(
        exerciseOrderInSession.flatMap((id) => {
          const ex = exerciseById.get(id);
          if (!ex) return [];
          return [
            {
              metric: ex.metric,
              restSeconds: ex.restTimerSecondsOverride ?? prefs.restTimerSeconds,
              setLogs: setLogsByExercise.get(id) ?? [],
            },
          ];
        }),
      )
    : null;

  // Handlers — all wrap server actions in a transition so UI stays responsive
  const handleAddExercises = (exerciseIds: string[]) => {
    if (exerciseIds.length === 0) return;
    startTransition(() => {
      addExercisesToActiveSession({ exerciseIds });
    });
    setPickerOpen(false);
    // Drop the carried-through chip selection — next picker open starts fresh
    // unless the user re-applies chips from the empty state. Mid-session
    // re-opens always start unfiltered.
    setPendingRegionIds([]);
    setPendingMuscleChipIds([]);
  };

  const openPicker = (regionIds: string[] = [], muscleChipIds: string[] = []) => {
    setPendingRegionIds(regionIds);
    setPendingMuscleChipIds(muscleChipIds);
    setPickerOpen(true);
  };

  // Open the picker in swap mode for a specific exercise. Pre-fills the chip
  // filter with the exercise's primary muscles so the user lands on a list
  // of plausible replacements; they can clear chips to widen the search.
  const startSwap = (exerciseId: string) => {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) return;
    setSwapTarget({ exerciseId, exerciseName: exercise.name });
    setPendingRegionIds([]);
    setPendingMuscleChipIds(muscleIdsToChipIds(exercise.primaryMuscles));
    setPickerOpen(true);
  };

  const handleSwap = (newExerciseId: string) => {
    if (!swapTarget) return;
    const oldExerciseId = swapTarget.exerciseId;
    startTransition(() => {
      swapExerciseInActiveSession({ oldExerciseId, newExerciseId });
    });
    setPickerOpen(false);
    setSwapTarget(null);
    setPendingRegionIds([]);
    setPendingMuscleChipIds([]);
  };

  const handleRemoveExercise = (exerciseId: string) => {
    startTransition(() => {
      removeExerciseFromActiveSession({ exerciseId });
    });
  };

  const handleAddSet = (exerciseId: string) => {
    startTransition(() => {
      addSet({ exerciseId });
    });
  };

  // Patch-shaped update so the row can send only the fields it actually touched
  // (reps + weight for metric='reps' exercises; seconds + weight for metric=
  // 'time'). `undefined` means "leave unchanged"; `null` means "clear."
  const handleUpdateSet = (
    setLogId: string,
    patch: {
      reps?: number | null;
      weight?: number | null;
      seconds?: number | null;
      bandId?: string | null;
    },
  ) => {
    startTransition(() => {
      updateSet({ setLogId, ...patch });
    });
    // Auto-start rest timer when a set is committed with meaningful values.
    // "Meaningful" = at least reps (for reps-metric) or seconds (for time-
    // metric) committed positive. Weight alone doesn't trigger — bodyweight
    // and band rows legitimately have null weight. The user's preference
    // toggle gates whether we actually start.
    const triggered =
      (patch.reps !== undefined && patch.reps !== null && patch.reps > 0) ||
      (patch.seconds !== undefined && patch.seconds !== null && patch.seconds > 0);
    if (prefs.restTimerEnabled && triggered) {
      // Look up the exercise's per-user override; fall back to the global default.
      const setLog = activeSession?.setLogs.find((s) => s.id === setLogId);
      const exercise = setLog ? availableExercises.find((e) => e.id === setLog.exerciseId) : null;
      const duration = exercise?.restTimerSecondsOverride ?? prefs.restTimerSeconds;
      restTimer.start(duration);
    }
  };

  const handleUpdateNotes = (setLogId: string, notes: string) => {
    startTransition(() => {
      updateSetNotes({ setLogId, notes });
    });
  };

  const handleSetExerciseRestOverride = (exerciseId: string, seconds: number | null) => {
    startTransition(() => {
      setExerciseRestOverride({ exerciseId, restTimerSeconds: seconds });
    });
  };

  const handleSetExerciseWeightIncrement = (exerciseId: string, increment: number | null) => {
    startTransition(() => {
      setExerciseWeightIncrement({ exerciseId, weightIncrement: increment });
    });
  };

  const handleRepeatLast = (exerciseId: string) => {
    startTransition(() => {
      repeatLastForExercise({ exerciseId });
    });
  };

  const handleRemoveSet = (setLogId: string) => {
    startTransition(() => {
      removeSet({ setLogId });
    });
  };

  const handleMoveExercise = (exerciseId: string, direction: 'up' | 'down') => {
    startTransition(() => {
      reorderExercise({ exerciseId, direction });
    });
  };

  const handleComplete = async () => {
    if (
      !(await confirm({
        title: 'Mark this workout complete?',
        message: 'It will be saved to your history and you can start a new one.',
        confirmLabel: 'Complete',
      }))
    )
      return;
    startTransition(() => completeActiveSession());
  };

  const handleDiscard = async () => {
    if (
      !(await confirm({
        title: 'Discard this workout?',
        message: 'All sets you logged in this session will be deleted. This cannot be undone.',
        confirmLabel: 'Discard',
        variant: 'danger',
      }))
    )
      return;
    startTransition(() => discardActiveSession());
  };

  const handleCreateCustom = (
    name: string,
    primaryMuscles: string[],
    secondaryMuscles: string[],
    prescription: string | undefined,
    videoUrl: string | undefined,
    restTimerSeconds: number | undefined,
  ) => {
    startTransition(() => {
      createCustomExercise({
        name,
        primaryMuscles,
        secondaryMuscles,
        prescription,
        videoUrl,
        restTimerSeconds,
      });
    });
  };

  // ============ TEMPLATES ============
  const handleStartFromTemplate = (templateId: string) => {
    startTransition(() => {
      startFromTemplate({ templateId });
    });
  };

  const handleDeleteTemplate = async (templateId: string, name: string) => {
    if (
      !(await confirm({
        title: `Delete template "${name}"?`,
        message: 'Existing sessions started from this template are not affected.',
        confirmLabel: 'Delete',
      }))
    ) {
      return;
    }
    startTransition(() => {
      deleteTemplate({ templateId });
    });
  };

  const handleHideTemplate = async (templateId: string, name: string) => {
    if (
      !(await confirm({
        title: `Hide "${name}"?`,
        message:
          'This is a default template — it will disappear from your list. Bring it back any time from Settings.',
        confirmLabel: 'Hide',
      }))
    ) {
      return;
    }
    startTransition(() => {
      hideTemplate({ templateId });
    });
  };

  /**
   * Save the active session as a named template. Returns true on success,
   * throws on failure. The dialog awaits this and only closes when it resolves
   * — preserves user input if the save fails.
   */
  const handleSaveAsTemplate = async (name: string, description: string | undefined) => {
    await saveActiveAsTemplate({ name, description });
    setSaveTemplateOpen(false);
  };

  const handleDeleteCustom = async (exerciseId: string) => {
    if (
      !(await confirm({
        title: 'Remove this exercise from your list?',
        message: 'Existing logged sets stay in your history. You can re-add it later.',
        confirmLabel: 'Remove',
        variant: 'danger',
      }))
    )
      return;
    startTransition(() => {
      deleteCustomExercise({ exerciseId });
    });
  };

  // ============ RENDER ============

  const sessionDate = activeSession ? new Date(activeSession.date) : new Date();
  const dateLabel = sessionDate.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="pb-32">
      {/* Rest timer — appears at the top when active, sticky during scroll */}
      <RestTimerBar
        controls={restTimer}
        prefs={prefs}
        onToggleSound={toggleSound}
        onToggleVibrate={toggleVibrate}
      />

      {/* Page header */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">
          <Calendar size={11} />
          {dateLabel}
        </div>
        <h1
          className="font-display text-3xl tracking-tight"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          {sessionStarted ? 'Workout in progress' : 'Ready when you are'}
        </h1>
        {sessionStarted && (
          <>
            <p className="text-sm text-ink-400 italic font-display mt-1">
              {exerciseOrderInSession.length}{' '}
              {exerciseOrderInSession.length === 1 ? 'exercise' : 'exercises'} ·{' '}
              {(activeSession?.setLogs ?? []).length}{' '}
              {(activeSession?.setLogs ?? []).length === 1 ? 'set' : 'sets'} logged
            </p>
            {sessionEstimate && sessionEstimate.totalSec > 0 && (
              <p className="text-[11px] text-ink-500 font-mono mt-1 flex items-center gap-1.5">
                <Clock size={11} className="text-ink-600" />
                <span>
                  ~{formatEstimate(sessionEstimate.totalSec)} total
                  {sessionEstimate.remainingSec > 0 && (
                    <>
                      <span className="text-ink-700"> · </span>
                      <span className="text-ink-300">
                        ~{formatEstimate(sessionEstimate.remainingSec)} more at typical pace
                      </span>
                    </>
                  )}
                </span>
              </p>
            )}
          </>
        )}
      </div>

      {/* Body */}
      {!sessionStarted ? (
        <EmptyState
          onOpenPicker={openPicker}
          templates={templates}
          onStartFromTemplate={handleStartFromTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onHideTemplate={handleHideTemplate}
          isPending={isPending}
          routine={routine}
          availableExercises={availableExercises}
        />
      ) : (
        <div className="px-5 space-y-4">
          {(() => {
            // Walk exercises in position order; emit a section header each time
            // the module changes. Preserves the user's reorders (so a Mobility
            // exercise tucked between two Strength Barbell ones gets its own
            // little section) without forcing a strict module-grouped layout
            // they didn't ask for.
            const elements: React.ReactNode[] = [];
            let lastModule: string | null = null;
            exerciseOrderInSession.forEach((exerciseId, idx) => {
              const exercise = exerciseById.get(exerciseId);
              if (!exercise) return;
              const sets = setLogsByExercise.get(exerciseId) ?? [];
              const last = lastByExercise.get(exerciseId);
              if (exercise.module !== lastModule) {
                const description = moduleDescription(exercise.module);
                elements.push(
                  <div
                    key={`module-${idx}`}
                    className="pt-4 first:pt-0 border-t border-ink-800/60 first:border-t-0"
                  >
                    <div className="pt-3 first:pt-0 pb-1">
                      <div className="text-xs tracking-[0.22em] uppercase text-ink-200 font-medium">
                        {exercise.module}
                      </div>
                      {description && (
                        <div className="text-[11px] text-ink-500 italic font-display leading-snug mt-1">
                          {description}
                        </div>
                      )}
                    </div>
                  </div>,
                );
                lastModule = exercise.module;
              }
              elements.push(
                <ExerciseInSession
                  key={exerciseId}
                  exercise={exercise}
                  sets={sets}
                  bands={bands}
                  routineNote={routineNoteByExercise.get(exerciseId) ?? null}
                  lastTime={
                    last
                      ? {
                          when: relativeDay(new Date(last.sessionDate)),
                          sets: last.sets,
                        }
                      : null
                  }
                  canMoveUp={idx > 0}
                  canMoveDown={idx < exerciseOrderInSession.length - 1}
                  globalRestSeconds={prefs.restTimerSeconds}
                  globalWeightIncrement={prefs.defaultWeightIncrement}
                  onAddSet={() => handleAddSet(exerciseId)}
                  onUpdateSet={handleUpdateSet}
                  onUpdateNotes={handleUpdateNotes}
                  onRemoveSet={handleRemoveSet}
                  onRemoveExercise={() => handleRemoveExercise(exerciseId)}
                  onMoveUp={() => handleMoveExercise(exerciseId, 'up')}
                  onMoveDown={() => handleMoveExercise(exerciseId, 'down')}
                  onSwap={() => startSwap(exerciseId)}
                  onSetRestOverride={(seconds) =>
                    handleSetExerciseRestOverride(exerciseId, seconds)
                  }
                  onSetWeightIncrementOverride={(inc) =>
                    handleSetExerciseWeightIncrement(exerciseId, inc)
                  }
                  onRepeatLast={() => handleRepeatLast(exerciseId)}
                />,
              );
            });
            return elements;
          })()}

          <button
            onClick={() => openPicker()}
            className="w-full mt-3 border border-dashed border-ink-700 rounded-lg py-3 text-sm text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add more exercises
          </button>

          {/* Save as template — small, secondary affordance */}
          <button
            onClick={() => setSaveTemplateOpen(true)}
            disabled={isPending}
            className="w-full mt-2 text-xs text-ink-500 hover:text-ink-100 transition py-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <BookmarkPlus size={12} />
            Save this lineup as a template
          </button>
        </div>
      )}

      {/* Picker sheet */}
      {pickerOpen && (
        <ExercisePicker
          availableExercises={availableExercises}
          // Exclude the swap target itself so we don't list "swap X for X" as
          // an option. In add mode, exclude everything already in the session.
          excludeIds={swapTarget ? new Set([swapTarget.exerciseId]) : exerciseIdsAlreadyInSession}
          initialRegionIds={pendingRegionIds}
          initialMuscleChipIds={pendingMuscleChipIds}
          onPickMany={handleAddExercises}
          swap={
            swapTarget
              ? {
                  targetName: swapTarget.exerciseName,
                  onPick: handleSwap,
                }
              : undefined
          }
          onClose={() => {
            setPickerOpen(false);
            setSwapTarget(null);
            setPendingRegionIds([]);
            setPendingMuscleChipIds([]);
          }}
          onCreateCustom={handleCreateCustom}
          onDeleteCustom={handleDeleteCustom}
        />
      )}

      {/* Sticky action bar — only when a session is in progress.
          On mobile, sits above the bottom nav (which is ~52px tall).
          On desktop, the nav is at the top so the action bar lives at bottom-0. */}
      {sessionStarted && (
        <div className="fixed bottom-[52px] sm:bottom-0 left-0 right-0 z-40 border-t border-ink-800 bg-ink-950/95 backdrop-blur px-5 py-3 flex items-center justify-between gap-3">
          <button
            onClick={handleDiscard}
            disabled={isPending}
            className="text-xs tracking-wider uppercase text-ink-500 hover:text-bad transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Discard
          </button>
          <button
            onClick={handleComplete}
            disabled={isPending}
            className="accent-bg text-ink-950 px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide flex items-center gap-2 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={14} strokeWidth={3} />
            Mark complete
          </button>
        </div>
      )}

      {ConfirmDialog}
      {saveTemplateOpen && (
        <SaveTemplateDialog
          onSave={handleSaveAsTemplate}
          onClose={() => setSaveTemplateOpen(false)}
          existingNames={new Set(templates.map((t) => t.name))}
        />
      )}
    </div>
  );
}

// ============ EMPTY STATE ============

function EmptyState({
  onOpenPicker,
  templates,
  onStartFromTemplate,
  onDeleteTemplate,
  onHideTemplate,
  isPending,
  routine,
  availableExercises,
}: {
  onOpenPicker: () => void;
  templates: TemplateClient[];
  onStartFromTemplate: (id: string) => void;
  onDeleteTemplate: (id: string, name: string) => void;
  onHideTemplate: (id: string, name: string) => void;
  isPending: boolean;
  routine: Omit<RoutineTimelineProps, 'availableExercises'> | null;
  availableExercises: ExerciseInfo[];
}) {
  // Built once and reused by every TemplateRow's time estimate — without this
  // each row built its own copy of the same map.
  const exerciseById = useMemo(
    () => new Map(availableExercises.map((e) => [e.id, e])),
    [availableExercises],
  );

  // Layered surface: a routine timeline (when the user has one) leads, with
  // template-list and ad-hoc paths underneath. Without a routine, the layout
  // is what it always was — templates and the picker.
  return (
    <div className="px-5 py-6 space-y-7">
      {routine && (
        <RoutineTimeline
          routine={routine.routine}
          todaysDay={routine.todaysDay}
          upcomingDays={routine.upcomingDays}
          recentSessions={routine.recentSessions}
          availableExercises={availableExercises}
        />
      )}

      {!routine && <BuildRoutineCTA />}

      {templates.length > 0 && (
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-3">
            {routine ? 'Or start from a template' : 'Start from a template'}
          </div>
          <div className="space-y-1.5">
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                exerciseById={exerciseById}
                onStart={() => onStartFromTemplate(t.id)}
                onDelete={() =>
                  t.isBuiltin ? onHideTemplate(t.id, t.name) : onDeleteTemplate(t.id, t.name)
                }
                disabled={isPending}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-3">
          {routine || templates.length > 0 ? 'Or build something else' : 'Build your own'}
        </div>
        <button
          onClick={() => onOpenPicker()}
          className="accent-bg text-ink-950 px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition inline-flex items-center gap-2"
        >
          <Plus size={16} strokeWidth={2.5} />
          Browse exercises
        </button>
      </div>
    </div>
  );
}

function BuildRoutineCTA() {
  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-3">
        Set up a routine
      </div>
      <Link
        href="/routine"
        className="block border border-ink-800 hover:border-accent/50 transition rounded-lg px-4 py-3 group"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-ink-100 flex items-center gap-2">
              Build a routine
              <span className="text-[9px] tracking-[0.2em] uppercase text-ink-500 border border-ink-800 rounded px-1.5 py-0.5">
                Optional
              </span>
            </div>
            <div className="text-[11px] text-ink-500 italic font-display mt-0.5 leading-relaxed">
              Pick or assemble the cycle of templates you rotate through. We&apos;ll flag any muscle
              groups your routine misses.
            </div>
          </div>
          <ArrowRight
            size={16}
            className="text-ink-500 group-hover:text-ink-100 group-hover:translate-x-0.5 transition shrink-0"
          />
        </div>
      </Link>
    </div>
  );
}

function TemplateRow({
  template,
  exerciseById,
  onStart,
  onDelete,
  disabled,
}: {
  template: TemplateClient;
  // Shared lookup built once by EmptyState — avoids each row rebuilding the
  // same map. Used to resolve each planned exercise's metric and per-user
  // rest override when computing the time estimate. Templates ship the
  // planned dimensions (sets/reps/seconds) but not the exercise's metric,
  // so we reach across.
  exerciseById: Map<string, ExerciseInfo>;
  // Called when the user taps the trash icon. The parent decides whether
  // this means "delete" (user template) or "hide" (built-in) — by the time
  // it reaches here both look the same.
  onStart: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const trailingActionLabel = template.isBuiltin ? 'Hide' : 'Delete';
  const { prefs } = usePrefs();

  const templateEstimateSec = estimatePlannedTotalSeconds(
    template.plannedExercises.flatMap((p) => {
      const ex = exerciseById.get(p.exerciseId);
      if (!ex) return [];
      return [
        {
          metric: ex.metric,
          restSeconds: ex.restTimerSecondsOverride ?? prefs.restTimerSeconds,
          plannedSets: p.plannedSets,
          plannedReps: p.plannedReps,
          plannedSeconds: p.plannedSeconds,
        },
      ];
    }),
  );

  return (
    <div className="border border-ink-800 hover:border-accent/40 transition rounded-lg flex items-stretch">
      <button
        onClick={onStart}
        disabled={disabled}
        className="flex-1 px-4 py-3 text-left disabled:opacity-50"
      >
        <div className="text-sm text-ink-100 flex items-center gap-2">
          <span>{template.name}</span>
          {template.isBuiltin && (
            <span className="text-[9px] tracking-[0.2em] uppercase text-ink-500 border border-ink-800 rounded px-1.5 py-0.5">
              Default
            </span>
          )}
        </div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {template.exerciseCount} {template.exerciseCount === 1 ? 'exercise' : 'exercises'}
          {templateEstimateSec > 0 && <span> · ~{formatEstimate(templateEstimateSec)}</span>}
          {template.previewNames.length > 0 && (
            <span className="text-ink-600">
              {' · '}
              {template.previewNames.join(', ')}
              {template.exerciseCount > template.previewNames.length ? '…' : ''}
            </span>
          )}
        </div>
      </button>
      <button
        onClick={onDelete}
        disabled={disabled}
        className="px-4 text-ink-500 hover:text-bad transition border-l border-ink-800 disabled:opacity-50"
        aria-label={`${trailingActionLabel} template ${template.name}`}
        title={`${trailingActionLabel} template`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ============ SAVE-AS-TEMPLATE DIALOG ============

function SaveTemplateDialog({
  onSave,
  onClose,
  existingNames,
}: {
  // Async — dialog awaits and closes itself on success, surfaces errors inline.
  onSave: (name: string, description: string | undefined) => Promise<void>;
  onClose: () => void;
  existingNames: Set<string>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ESC-to-close, matching the picker's behavior. Disabled while submitting
  // so the user doesn't accidentally lose in-flight input by hitting ESC.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, submitting]);

  const trimmedName = name.trim();
  const collision = trimmedName.length > 0 && existingNames.has(trimmedName);
  const canSave = trimmedName.length > 0 && !collision && !submitting;

  async function submit() {
    if (!canSave) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSave(trimmedName, description.trim() || undefined);
      // Dialog closes via parent state change; no setSubmitting(false) needed.
    } catch (err) {
      // Surface the error inline rather than letting it bubble. Most likely
      // cause is a name-collision race (someone added a template in another
      // tab between this dialog opening and submit).
      setServerError(
        err instanceof Error ? err.message : 'Could not save the template. Try again?',
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
    >
      <div
        className="bg-ink-950 border border-ink-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md sm:mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="save-template-title" className="font-display text-2xl mb-1">
          Save as template
        </h2>
        <p className="text-xs text-ink-500 italic font-display mb-4">
          Just the exercises and order. Sets, reps, and weights stay with this session.
        </p>

        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (serverError) setServerError(null);
          }}
          disabled={submitting}
          placeholder="e.g. Lower body day"
          autoFocus
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:border-accent/50 disabled:opacity-60"
        />
        {collision && (
          <p className="text-[10px] text-bad mb-3">You already have a template by that name.</p>
        )}
        {!collision && !serverError && <div className="mb-4" />}
        {serverError && <p className="text-[10px] text-bad mb-3">{serverError}</p>}

        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Description <span className="text-ink-600">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          placeholder="What's this for?"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-5 focus:outline-none focus:border-accent/50 disabled:opacity-60"
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs tracking-wider uppercase text-ink-300 hover:text-ink-100 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
