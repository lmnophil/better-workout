'use client';

// The interactive workout tracker.
// Receives initial data from the server, calls server actions for every mutation.
// Uses isPending from useTransition to disable buttons during in-flight actions
// (prevents double-submit) and useConfirm for on-brand confirmation dialogs.

import { useState, useTransition, useEffect } from 'react';
import { Plus, Check, Calendar, Trash2, BookmarkPlus } from 'lucide-react';
import {
  addExerciseToActiveSession,
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
} from '@/lib/actions';
import { ExerciseInSession } from './exercise-in-session';
import { ExercisePicker } from './exercise-picker';
import { RestTimerBar, useRestTimer } from './rest-timer';
import { useConfirm } from '@/components/ui/use-confirm';
import { usePrefs } from '@/components/ui/prefs-context';
import { groupBy, relativeDay } from '@/lib/utils';

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
  // Per-user rest timer override; null = use the global default from preferences
  restTimerSecondsOverride: number | null;
};

export type SetLogClient = {
  id: string;
  exerciseId: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
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
    notes: string | null;
  }[];
};

export type TemplateClient = {
  id: string;
  name: string;
  description: string | null;
  exerciseCount: number;
  // Names of the first few exercises, for preview
  previewNames: string[];
  updatedAt: string; // ISO
};

type Props = {
  activeSession: ActiveSessionClient | null;
  availableExercises: ExerciseInfo[];
  lastSets: LastSetsForExercise[];
  templates: TemplateClient[];
};

// ============ COMPONENT ============

export function WorkoutView({
  activeSession,
  availableExercises,
  lastSets,
  templates,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const { prefs, updatePrefs } = usePrefs();
  const restTimer = useRestTimer(prefs);

  // ============ PREFERENCE TOGGLES (from rest timer bar) ============
  // Shared context handles the optimistic update + persistence.
  const toggleSound = () => updatePrefs({ restTimerSound: !prefs.restTimerSound });
  const toggleVibrate = () => updatePrefs({ restTimerVibrate: !prefs.restTimerVibrate });

  // Quick lookups
  const exerciseById = new Map(availableExercises.map((e) => [e.id, e]));
  const lastByExercise = new Map(lastSets.map((l) => [l.exerciseId, l]));

  // Group active session's setLogs by exerciseId, preserving order of first appearance
  const setLogsByExercise = groupBy(activeSession?.setLogs ?? [], (s) => s.exerciseId);
  const exerciseOrderInSession: string[] = [];
  for (const set of activeSession?.setLogs ?? []) {
    if (!exerciseOrderInSession.includes(set.exerciseId)) {
      exerciseOrderInSession.push(set.exerciseId);
    }
  }

  const exerciseIdsAlreadyInSession = new Set(exerciseOrderInSession);
  const sessionStarted = activeSession !== null && exerciseOrderInSession.length > 0;

  // Handlers — all wrap server actions in a transition so UI stays responsive
  const handleAddExercise = (exerciseId: string) => {
    startTransition(() => {
      addExerciseToActiveSession({ exerciseId });
    });
    setPickerOpen(false);
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

  const handleUpdateSet = (
    setLogId: string,
    reps: number | null,
    weight: number | null,
  ) => {
    startTransition(() => {
      updateSet({ setLogId, reps, weight });
    });
    // Auto-start rest timer when a set is committed with meaningful values.
    // We define "committed" as having at least reps logged (weight may legitimately
    // be null for bodyweight or band exercises). The user's preference toggle
    // gates whether we actually start.
    if (prefs.restTimerEnabled && reps !== null && reps > 0) {
      // Look up the exercise's per-user override; fall back to the global default.
      const setLog = activeSession?.setLogs.find((s) => s.id === setLogId);
      const exercise = setLog
        ? availableExercises.find((e) => e.id === setLog.exerciseId)
        : null;
      const duration =
        exercise?.restTimerSecondsOverride ?? prefs.restTimerSeconds;
      restTimer.start(duration);
    }
  };

  const handleUpdateNotes = (setLogId: string, notes: string) => {
    startTransition(() => {
      updateSetNotes({ setLogId, notes });
    });
  };

  const handleSetExerciseRestOverride = (
    exerciseId: string,
    seconds: number | null,
  ) => {
    startTransition(() => {
      setExerciseRestOverride({ exerciseId, restTimerSeconds: seconds });
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
          <p className="text-sm text-ink-400 italic font-display mt-1">
            {exerciseOrderInSession.length}{' '}
            {exerciseOrderInSession.length === 1 ? 'exercise' : 'exercises'} ·{' '}
            {(activeSession?.setLogs ?? []).length}{' '}
            {(activeSession?.setLogs ?? []).length === 1 ? 'set' : 'sets'} logged
          </p>
        )}
      </div>

      {/* Body */}
      {!sessionStarted ? (
        <EmptyState
          onPick={() => setPickerOpen(true)}
          templates={templates}
          onStartFromTemplate={handleStartFromTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          isPending={isPending}
        />
      ) : (
        <div className="px-5 space-y-3">
          {exerciseOrderInSession.map((exerciseId, idx) => {
            const exercise = exerciseById.get(exerciseId);
            if (!exercise) return null; // Defensive — shouldn't happen
            const sets = setLogsByExercise.get(exerciseId) ?? [];
            const last = lastByExercise.get(exerciseId);
            return (
              <ExerciseInSession
                key={exerciseId}
                exercise={exercise}
                sets={sets}
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
                onAddSet={() => handleAddSet(exerciseId)}
                onUpdateSet={handleUpdateSet}
                onUpdateNotes={handleUpdateNotes}
                onRemoveSet={handleRemoveSet}
                onRemoveExercise={() => handleRemoveExercise(exerciseId)}
                onMoveUp={() => handleMoveExercise(exerciseId, 'up')}
                onMoveDown={() => handleMoveExercise(exerciseId, 'down')}
                onSetRestOverride={(seconds) =>
                  handleSetExerciseRestOverride(exerciseId, seconds)
                }
              />
            );
          })}

          <button
            onClick={() => setPickerOpen(true)}
            className="w-full mt-3 border border-dashed border-ink-700 rounded-lg py-3 text-sm text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add another exercise
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
          excludeIds={exerciseIdsAlreadyInSession}
          onPick={handleAddExercise}
          onClose={() => setPickerOpen(false)}
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
  onPick,
  templates,
  onStartFromTemplate,
  onDeleteTemplate,
  isPending,
}: {
  onPick: () => void;
  templates: TemplateClient[];
  onStartFromTemplate: (id: string) => void;
  onDeleteTemplate: (id: string, name: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="px-5 py-6">
      {templates.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-3">
            Start from a template
          </div>
          <div className="space-y-1.5">
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                onStart={() => onStartFromTemplate(t.id)}
                onDelete={() => onDeleteTemplate(t.id, t.name)}
                disabled={isPending}
              />
            ))}
          </div>
        </div>
      )}

      <div className="border border-dashed border-ink-800 rounded-xl p-8 text-center">
        <p className="text-sm text-ink-300 leading-relaxed mb-1">
          {templates.length > 0 ? 'Or build it from scratch.' : 'No exercises logged yet for today.'}
        </p>
        <p className="text-xs text-ink-500 italic font-display mb-6">
          Pick an exercise to start the session — it&apos;ll save automatically as you go.
        </p>
        <button
          onClick={onPick}
          className="accent-bg text-ink-950 px-5 py-3 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition inline-flex items-center gap-2"
        >
          <Plus size={16} strokeWidth={2.5} />
          Pick an exercise
        </button>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  onStart,
  onDelete,
  disabled,
}: {
  template: TemplateClient;
  onStart: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border border-ink-800 hover:border-accent/40 transition rounded-lg flex items-stretch">
      <button
        onClick={onStart}
        disabled={disabled}
        className="flex-1 px-4 py-3 text-left disabled:opacity-50"
      >
        <div className="text-sm text-ink-100">{template.name}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {template.exerciseCount}{' '}
          {template.exerciseCount === 1 ? 'exercise' : 'exercises'}
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
        aria-label={`Delete template ${template.name}`}
        title="Delete template"
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
        err instanceof Error
          ? err.message
          : 'Could not save the template. Try again?',
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
          <p className="text-[10px] text-bad mb-3">
            You already have a template by that name.
          </p>
        )}
        {!collision && !serverError && <div className="mb-4" />}
        {serverError && (
          <p className="text-[10px] text-bad mb-3">{serverError}</p>
        )}

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
