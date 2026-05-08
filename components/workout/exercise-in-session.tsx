'use client';

// One exercise within the active session. Renders:
//   - header with module tag, name, optional video link, reorder + remove controls
//   - prescription line with inline rest-timer editor (override per exercise)
//   - last-time reference line
//   - set rows with reps/weight inputs, saved indicator, per-set notes (collapsible)

import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Minus,
  X,
  Check,
  ChevronUp,
  ChevronDown,
  PlayCircle,
  Settings2,
  StickyNote,
} from 'lucide-react';
import type { ExerciseInfo, SetLogClient } from './workout-view';

type Props = {
  exercise: ExerciseInfo;
  sets: SetLogClient[];
  lastTime: {
    when: string; // "today" | "1d ago" | "3d ago" ...
    sets: {
      setNumber: number;
      reps: number | null;
      weight: number | null;
      notes: string | null;
    }[];
  } | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  // The user's global default rest seconds — shown as the "use default" preset.
  globalRestSeconds: number;
  onAddSet: () => void;
  onUpdateSet: (setLogId: string, reps: number | null, weight: number | null) => void;
  onUpdateNotes: (setLogId: string, notes: string) => void;
  onRemoveSet: (setLogId: string) => void;
  onRemoveExercise: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetRestOverride: (seconds: number | null) => void;
};

// Preset rest durations, in seconds. Mirrors the settings page presets so the
// inline picker feels consistent.
const REST_PRESETS = [30, 60, 90, 120, 180, 240];

export function ExerciseInSession({
  exercise,
  sets,
  lastTime,
  canMoveUp,
  canMoveDown,
  globalRestSeconds,
  onAddSet,
  onUpdateSet,
  onUpdateNotes,
  onRemoveSet,
  onRemoveExercise,
  onMoveUp,
  onMoveDown,
  onSetRestOverride,
}: Props) {
  const [editingRest, setEditingRest] = useState(false);

  const isOverridden = exercise.restTimerSecondsOverride !== null;
  const effectiveRest = exercise.restTimerSecondsOverride ?? globalRestSeconds;

  function pickRest(seconds: number) {
    onSetRestOverride(seconds);
    setEditingRest(false);
  }
  function clearOverride() {
    onSetRestOverride(null);
    setEditingRest(false);
  }

  return (
    <div className="border accent-border bg-ink-900 rounded-lg">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] tracking-[0.2em] uppercase text-ink-500">
              {exercise.module}
            </span>
            {exercise.isCustom && (
              <span className="text-[9px] tracking-[0.2em] uppercase accent-text">
                · Custom
              </span>
            )}
          </div>
          <div className="text-sm font-medium text-ink-100 flex items-center gap-2">
            <span>{exercise.name}</span>
            {exercise.videoUrl && (
              <a
                href={exercise.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-500 hover:accent-text transition shrink-0"
                aria-label={`Watch ${exercise.name} demonstration`}
                title="Watch demo"
              >
                <PlayCircle size={14} />
              </a>
            )}
          </div>

          {/* Prescription + rest editor — same row, wraps on narrow screens */}
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {exercise.prescription && (
              <span className="text-[11px] text-ink-500 font-mono">
                {exercise.prescription}
              </span>
            )}
            <button
              type="button"
              onClick={() => setEditingRest((e) => !e)}
              className="text-[11px] text-ink-500 hover:text-ink-300 transition flex items-center gap-1 -my-0.5 py-0.5 px-1 -ml-1 rounded"
              aria-label={`Edit rest timer for ${exercise.name}`}
              aria-expanded={editingRest}
            >
              <Settings2 size={10} className="opacity-70" />
              <span>rest {formatRest(effectiveRest)}</span>
              {isOverridden && <span className="accent-text">·custom</span>}
            </button>
          </div>
        </div>

        <div className="flex items-start gap-0 -mt-1.5 -mr-1.5 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="text-ink-500 hover:text-ink-100 transition p-2 disabled:opacity-25 disabled:cursor-not-allowed"
            aria-label={`Move ${exercise.name} up`}
            title="Move up"
          >
            <ChevronUp size={18} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="text-ink-500 hover:text-ink-100 transition p-2 disabled:opacity-25 disabled:cursor-not-allowed"
            aria-label={`Move ${exercise.name} down`}
            title="Move down"
          >
            <ChevronDown size={18} />
          </button>
          <button
            onClick={onRemoveExercise}
            className="text-ink-500 hover:text-bad transition p-2"
            aria-label={`Remove ${exercise.name} from workout`}
            title="Remove from session"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Inline rest editor — only when toggled */}
      {editingRest && (
        <div className="px-4 pb-3">
          <div className="bg-ink-950/60 rounded-lg p-2.5 space-y-2">
            <div className="text-[10px] tracking-[0.2em] uppercase text-ink-500">
              Rest after each set
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REST_PRESETS.map((s) => {
                const active = exercise.restTimerSecondsOverride === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pickRest(s)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      active
                        ? 'accent-bg text-ink-950 border-transparent'
                        : 'border-ink-800 text-ink-300 hover:border-ink-600'
                    }`}
                  >
                    {formatRest(s)}
                  </button>
                );
              })}
            </div>
            {isOverridden && (
              <button
                type="button"
                onClick={clearOverride}
                className="text-[10px] text-ink-500 hover:text-ink-300 transition"
              >
                Use default ({formatRest(globalRestSeconds)})
              </button>
            )}
            {!isOverridden && (
              <p className="text-[10px] text-ink-600 italic font-display">
                Currently using your default. Pick a preset to override just this exercise.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Last-time line */}
      {lastTime && (
        <div className="px-4 py-1.5 border-t border-ink-800">
          <div className="text-[11px] font-mono text-ink-400">
            Last {lastTime.when}:{' '}
            <span className="accent-text">
              {lastTime.sets
                .map((s) => `${s.reps ?? '–'}×${s.weight ?? '–'}`)
                .join('  ')}
            </span>
          </div>
          {/* Surface any notes from that session — small, dimmed, attributed to
              the set they came from. Prior context is gold for the next attempt. */}
          {lastTime.sets.some((s) => s.notes) && (
            <div className="mt-1 space-y-0.5">
              {lastTime.sets
                .filter((s) => s.notes)
                .map((s) => (
                  <div
                    key={s.setNumber}
                    className="text-[10px] text-ink-500 italic font-display leading-snug"
                  >
                    <span className="text-ink-600 font-mono not-italic mr-1">
                      set {s.setNumber}
                    </span>
                    {s.notes}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Set inputs */}
      <div className="px-4 pb-3 pt-2 border-t border-ink-800 space-y-1.5">
        {sets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            onUpdate={(reps, weight) => onUpdateSet(set.id, reps, weight)}
            onUpdateNotes={(notes) => onUpdateNotes(set.id, notes)}
            onRemove={() => onRemoveSet(set.id)}
          />
        ))}
        <button
          onClick={onAddSet}
          className="text-xs accent-text flex items-center gap-1 hover:opacity-80 transition mt-1"
        >
          <Plus size={12} /> Add set
        </button>
      </div>
    </div>
  );
}

// ============ SET ROW ============

function SetRow({
  set,
  onUpdate,
  onUpdateNotes,
  onRemove,
}: {
  set: SetLogClient;
  onUpdate: (reps: number | null, weight: number | null) => void;
  onUpdateNotes: (notes: string) => void;
  onRemove: () => void;
}) {
  // Local mirror state — keystrokes feel instant; server sync happens on blur.
  // Storing as strings to allow empty input (vs forcing 0).
  const [reps, setReps] = useState<string>(set.reps?.toString() ?? '');
  const [weight, setWeight] = useState<string>(set.weight?.toString() ?? '');
  const [notesOpen, setNotesOpen] = useState(
    set.notes !== null && set.notes !== '',
  );
  const [notesValue, setNotesValue] = useState(set.notes ?? '');
  const [justSaved, setJustSaved] = useState(false);

  const repsRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // Cleared on unmount so we don't fire setState after the component is gone.
  const justSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (justSavedTimerRef.current !== null) {
        clearTimeout(justSavedTimerRef.current);
      }
    };
  }, []);

  // Sync local state with prop changes — but only when the input isn't focused,
  // so we don't yank values out from under someone who's actively typing.
  // Handles the "edit on phone, see update on desktop" case.
  useEffect(() => {
    if (document.activeElement !== repsRef.current) {
      setReps(set.reps?.toString() ?? '');
    }
    if (document.activeElement !== weightRef.current) {
      setWeight(set.weight?.toString() ?? '');
    }
    if (document.activeElement !== notesRef.current) {
      setNotesValue(set.notes ?? '');
    }
  }, [set.reps, set.weight, set.notes]);

  function commit() {
    const newReps = reps.trim() === '' ? null : Number(reps);
    const newWeight = weight.trim() === '' ? null : Number(weight);
    if (Number.isNaN(newReps) || Number.isNaN(newWeight)) return;
    if (newReps === set.reps && newWeight === set.weight) return;
    onUpdate(newReps, newWeight);
    // Optimistic "saved" indicator — server action is fast enough that showing
    // confirmation immediately feels right. If it fails, the error boundary catches it.
    setJustSaved(true);
    if (justSavedTimerRef.current !== null) {
      clearTimeout(justSavedTimerRef.current);
    }
    justSavedTimerRef.current = setTimeout(() => {
      setJustSaved(false);
      justSavedTimerRef.current = null;
    }, 1200);
  }

  function commitNotes() {
    const trimmed = notesValue.trim();
    if (trimmed === (set.notes ?? '')) return;
    onUpdateNotes(trimmed);
  }

  const hasNote = (set.notes ?? '').length > 0;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="font-mono text-[10px] tracking-wider text-ink-500 w-8 shrink-0">
          SET {set.setNumber}
        </div>
        <input
          ref={repsRef}
          type="number"
          inputMode="numeric"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          onBlur={commit}
          placeholder="reps"
          aria-label={`Set ${set.setNumber} reps`}
          className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded px-2 py-2 text-sm font-mono text-center focus:outline-none focus:border-accent/50"
        />
        <span className="text-ink-600 text-xs shrink-0">×</span>
        <input
          ref={weightRef}
          type="number"
          inputMode="decimal"
          step="0.5"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={commit}
          placeholder="lbs"
          aria-label={`Set ${set.setNumber} weight`}
          className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded px-2 py-2 text-sm font-mono text-center focus:outline-none focus:border-accent/50"
        />
        {/* Saved indicator — shows a check briefly after commit. Fixed-width slot
            so adjacent buttons don't shift when it appears/disappears. */}
        <div className="w-4 shrink-0 flex items-center justify-center">
          {justSaved && <Check size={14} className="accent-text" strokeWidth={2.5} />}
        </div>
        <button
          onClick={() => setNotesOpen((o) => !o)}
          className={`p-2 transition shrink-0 ${
            hasNote
              ? 'accent-text hover:brightness-110'
              : 'text-ink-500 hover:text-ink-100'
          }`}
          aria-label={`${hasNote ? 'Edit' : 'Add'} note for set ${set.setNumber}`}
          aria-expanded={notesOpen}
          title={hasNote ? 'Note' : 'Add a note'}
        >
          <StickyNote size={14} fill={hasNote ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={onRemove}
          className="text-ink-500 hover:text-bad transition p-2 shrink-0"
          aria-label={`Remove set ${set.setNumber}`}
          title="Remove set"
        >
          <Minus size={16} />
        </button>
      </div>

      {/* Note expansion — single-line by default, grows to two lines on focus */}
      {notesOpen && (
        <div className="mt-1.5 ml-10">
          <textarea
            ref={notesRef}
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              // Enter without shift commits + closes; shift+enter adds a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="RPE 8, last rep grindy, etc."
            rows={1}
            maxLength={500}
            className="w-full bg-ink-950 border border-ink-800 rounded px-2 py-1.5 text-[12px] font-mono text-ink-200 resize-y focus:outline-none focus:border-accent/50"
          />
        </div>
      )}
    </div>
  );
}

// Render seconds compactly: "30s", "1:30", "3m"
function formatRest(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === 0) return `${m}m`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
