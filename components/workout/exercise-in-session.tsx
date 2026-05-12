'use client';

// One exercise within the active session. Renders:
//   - header with name, custom marker, optional video link, reorder + remove controls
//     (the module tag lives on the section header above the card, not here)
//   - prescription line with inline settings panel (rest + weight increment override)
//   - last-time reference line + a "Repeat last" affordance to snap back to it
//   - tight set rows with reps input, weight stepper, note, and remove controls

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
  Replace,
  RotateCcw,
} from 'lucide-react';
import type { ExerciseInfo, SetLogClient } from './workout-view';
import { estimateActiveExerciseSeconds, formatEstimateCompact } from '@/lib/time-estimate';

type Props = {
  exercise: ExerciseInfo;
  sets: SetLogClient[];
  // Per-day, per-exercise free-text note the user wrote on the routine.
  // Read-only here — edits happen on the routine editor page. Null when
  // either the session wasn't started from a routine day or no note was set.
  routineNote: string | null;
  lastTime: {
    when: string; // "today" | "1d ago" | "3d ago" ...
    sets: {
      setNumber: number;
      reps: number | null;
      weight: number | null;
      seconds: number | null;
      notes: string | null;
    }[];
  } | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  // The user's global default rest seconds — shown as the "use default" preset.
  globalRestSeconds: number;
  // The user's global default weight stepper increment.
  globalWeightIncrement: number;
  onAddSet: () => void;
  // Patch-shaped — caller sends only the fields it touched. reps/seconds are
  // mutually exclusive in normal use, dictated by exercise.metric.
  onUpdateSet: (
    setLogId: string,
    patch: {
      reps?: number | null;
      weight?: number | null;
      seconds?: number | null;
    },
  ) => void;
  onUpdateNotes: (setLogId: string, notes: string) => void;
  onRemoveSet: (setLogId: string) => void;
  onRemoveExercise: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  // Open the picker to replace this exercise with another in the same slot.
  onSwap: () => void;
  onSetRestOverride: (seconds: number | null) => void;
  onSetWeightIncrementOverride: (increment: number | null) => void;
  // Snap the current sets to match the user's last-time set count and reps/weight/seconds.
  onRepeatLast: () => void;
};

const REST_PRESETS = [30, 60, 90, 120, 180, 240];
// Weight-increment presets cover micro-plates (1, 2.5), the common 5lb floor,
// and a wider 10 for big lifts. Users with stranger increments use the global
// default editor in settings rather than a per-exercise override here.
const INCREMENT_PRESETS = [1, 2.5, 5, 10];

export function ExerciseInSession({
  exercise,
  sets,
  routineNote,
  lastTime,
  canMoveUp,
  canMoveDown,
  globalRestSeconds,
  globalWeightIncrement,
  onAddSet,
  onUpdateSet,
  onUpdateNotes,
  onRemoveSet,
  onRemoveExercise,
  onMoveUp,
  onMoveDown,
  onSwap,
  onSetRestOverride,
  onSetWeightIncrementOverride,
  onRepeatLast,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const restOverridden = exercise.restTimerSecondsOverride !== null;
  const incrementOverridden = exercise.weightIncrementOverride !== null;
  const effectiveRest = exercise.restTimerSecondsOverride ?? globalRestSeconds;
  const effectiveIncrement = exercise.weightIncrementOverride ?? globalWeightIncrement;

  // The repeat-last chip shows whenever last-time exists. The user can tap it
  // mid-session if they want to revert any manual edits and snap to history.
  const canRepeatLast = lastTime !== null && lastTime.sets.length > 0;

  // Time estimate for this exercise. Each existing set log is treated as a
  // planned set; filled rows weight by their actual reps/seconds. Hidden when
  // there's nothing to estimate yet (no sets added).
  const exerciseEstimateSec =
    sets.length > 0
      ? estimateActiveExerciseSeconds({
          metric: exercise.metric,
          restSeconds: effectiveRest,
          setLogs: sets.map((s) => ({ reps: s.reps, seconds: s.seconds })),
        })
      : 0;

  return (
    <div className="border accent-border bg-ink-900 rounded-lg">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-100 flex items-center gap-2">
            <span>{exercise.name}</span>
            {exercise.isCustom && (
              <span className="text-[9px] tracking-[0.2em] uppercase accent-text shrink-0">
                Custom
              </span>
            )}
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

          {/* Prescription + settings opener — same row, wraps on narrow screens */}
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {exercise.prescription && (
              <span className="text-[11px] text-ink-500 font-mono">{exercise.prescription}</span>
            )}
            {exerciseEstimateSec > 0 && (
              <span className="text-[11px] text-ink-500 font-mono">
                ~{formatEstimateCompact(exerciseEstimateSec)}
              </span>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen((e) => !e)}
              className="text-[11px] text-ink-500 hover:text-ink-300 transition flex items-center gap-1 -my-0.5 py-0.5 px-1 -ml-1 rounded"
              aria-label={`Edit per-exercise settings for ${exercise.name}`}
              aria-expanded={settingsOpen}
            >
              <Settings2 size={10} className="opacity-70" />
              <span>rest {formatRest(effectiveRest)}</span>
              {restOverridden && <span className="accent-text">·custom</span>}
              <span className="text-ink-700 mx-0.5">·</span>
              <span>step {formatIncrement(effectiveIncrement)}</span>
              {incrementOverridden && <span className="accent-text">·custom</span>}
            </button>
          </div>

          {routineNote && (
            <p className="text-[11px] text-ink-300 italic font-display leading-snug mt-1 whitespace-pre-wrap break-words">
              {routineNote}
            </p>
          )}
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
            onClick={onSwap}
            className="text-ink-500 hover:accent-text transition p-2"
            aria-label={`Swap ${exercise.name} for another exercise`}
            title="Swap for another exercise"
          >
            <Replace size={16} />
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

      {/* Inline settings — only when toggled. Two grouped sections so rest and
          increment overrides feel related but distinct. */}
      {settingsOpen && (
        <div className="px-4 pb-3 space-y-2">
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
                    onClick={() => onSetRestOverride(s)}
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
            {restOverridden ? (
              <button
                type="button"
                onClick={() => onSetRestOverride(null)}
                className="text-[10px] text-ink-500 hover:text-ink-300 transition"
              >
                Use default ({formatRest(globalRestSeconds)})
              </button>
            ) : (
              <p className="text-[10px] text-ink-600 italic font-display">
                Using your default. Pick a preset to override just this exercise.
              </p>
            )}
          </div>

          <div className="bg-ink-950/60 rounded-lg p-2.5 space-y-2">
            <div className="text-[10px] tracking-[0.2em] uppercase text-ink-500">
              Weight increment
            </div>
            <div className="flex flex-wrap gap-1.5">
              {INCREMENT_PRESETS.map((n) => {
                const active = exercise.weightIncrementOverride === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onSetWeightIncrementOverride(n)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      active
                        ? 'accent-bg text-ink-950 border-transparent'
                        : 'border-ink-800 text-ink-300 hover:border-ink-600'
                    }`}
                  >
                    {formatIncrement(n)}
                  </button>
                );
              })}
            </div>
            {incrementOverridden ? (
              <button
                type="button"
                onClick={() => onSetWeightIncrementOverride(null)}
                className="text-[10px] text-ink-500 hover:text-ink-300 transition"
              >
                Use default ({formatIncrement(globalWeightIncrement)})
              </button>
            ) : (
              <p className="text-[10px] text-ink-600 italic font-display">
                Using your default. Pick a preset to nudge the +/- step for this exercise.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Last-time line + repeat-last chip */}
      {lastTime && (
        <div className="px-4 py-1.5 border-t border-ink-800">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[11px] font-mono text-ink-400">
              Last {lastTime.when}:{' '}
              <span className="accent-text">
                {lastTime.sets
                  .map((s) =>
                    exercise.metric === 'time'
                      ? `${s.seconds ?? '–'}s${s.weight ? `@${s.weight}` : ''}`
                      : `${s.reps ?? '–'}×${s.weight ?? '–'}`,
                  )
                  .join('  ')}
              </span>
            </div>
            {canRepeatLast && (
              <button
                type="button"
                onClick={onRepeatLast}
                className="ml-auto text-[10px] tracking-wider uppercase text-ink-500 hover:accent-text transition flex items-center gap-1 px-2 py-0.5 rounded-full border border-ink-800 hover:border-accent/50"
                aria-label="Snap current sets to match last time"
                title="Match last-time set count and values"
              >
                <RotateCcw size={10} />
                Repeat last
              </button>
            )}
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
      <div className="px-3 pt-1.5 pb-2.5 border-t border-ink-800">
        {/* Compact column hint shown once, instead of repeating "SET N" per row.
            Aligns visually with the set rows below; subordinates additional
            sets to the first instead of stacking same-weight cards. */}
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[9px] tracking-[0.2em] uppercase text-ink-600">
          <span className="w-4 shrink-0 text-center">#</span>
          <span className="flex-1 min-w-0 text-center">
            {exercise.metric === 'time' ? 'Sec' : 'Reps'}
          </span>
          <span className="w-3 shrink-0" />
          <span className="flex-1 min-w-0 text-center">Weight</span>
          <span className="w-4 shrink-0" />
          <span className="w-7 shrink-0" />
          <span className="w-7 shrink-0" />
        </div>
        <div className="divide-y divide-ink-900/60">
          {sets.map((set) => (
            <SetRow
              key={set.id}
              set={set}
              metric={exercise.metric}
              increment={effectiveIncrement}
              onUpdate={(patch) => onUpdateSet(set.id, patch)}
              onUpdateNotes={(notes) => onUpdateNotes(set.id, notes)}
              onRemove={() => onRemoveSet(set.id)}
            />
          ))}
        </div>
        <button
          onClick={onAddSet}
          className="text-xs accent-text flex items-center gap-1 hover:opacity-80 transition mt-1.5 ml-1"
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
  metric,
  increment,
  onUpdate,
  onUpdateNotes,
  onRemove,
}: {
  set: SetLogClient;
  metric: string;
  increment: number;
  onUpdate: (patch: {
    reps?: number | null;
    weight?: number | null;
    seconds?: number | null;
  }) => void;
  onUpdateNotes: (notes: string) => void;
  onRemove: () => void;
}) {
  const isTime = metric === 'time';

  // Local mirror state — keystrokes feel instant; server sync happens on blur.
  // Storing as strings to allow empty input (vs forcing 0). For time-metric
  // exercises the first input mirrors `seconds`; for reps-metric, `reps`. The
  // weight input is shared either way.
  const [primary, setPrimary] = useState<string>(
    (isTime ? set.seconds : set.reps)?.toString() ?? '',
  );
  const [weight, setWeight] = useState<string>(formatWeight(set.weight));
  const [notesOpen, setNotesOpen] = useState(set.notes !== null && set.notes !== '');
  const [notesValue, setNotesValue] = useState(set.notes ?? '');
  const [justSaved, setJustSaved] = useState(false);

  const primaryRef = useRef<HTMLInputElement>(null);
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
  // Handles the "edit on phone, see update on desktop" case AND the
  // server-side repeat-last action that rewrites server-side.
  useEffect(() => {
    if (document.activeElement !== primaryRef.current) {
      const next = isTime ? set.seconds : set.reps;
      setPrimary(next?.toString() ?? '');
    }
    if (document.activeElement !== weightRef.current) {
      setWeight(formatWeight(set.weight));
    }
    if (document.activeElement !== notesRef.current) {
      setNotesValue(set.notes ?? '');
    }
  }, [set.reps, set.seconds, set.weight, set.notes, isTime]);

  function flashSaved() {
    setJustSaved(true);
    if (justSavedTimerRef.current !== null) {
      clearTimeout(justSavedTimerRef.current);
    }
    justSavedTimerRef.current = setTimeout(() => {
      setJustSaved(false);
      justSavedTimerRef.current = null;
    }, 1200);
  }

  function commit() {
    const newPrimary = primary.trim() === '' ? null : Number(primary);
    const newWeight = weight.trim() === '' ? null : Number(weight);
    if (Number.isNaN(newPrimary) || Number.isNaN(newWeight)) return;
    const patch: { reps?: number | null; weight?: number | null; seconds?: number | null } = {};
    if (isTime) {
      if (newPrimary !== set.seconds) patch.seconds = newPrimary;
    } else {
      if (newPrimary !== set.reps) patch.reps = newPrimary;
    }
    if (newWeight !== set.weight) patch.weight = newWeight;
    if (Object.keys(patch).length === 0) return;
    onUpdate(patch);
    flashSaved();
  }

  function commitNotes() {
    const trimmed = notesValue.trim();
    if (trimmed === (set.notes ?? '')) return;
    onUpdateNotes(trimmed);
  }

  // Stepper: nudge weight by ±increment and commit immediately. The local
  // string state is updated alongside so the user sees the change without
  // losing focus. Negative results clamp at 0 — most lifts don't go negative,
  // and clamping is clearer than disallowing the press.
  function nudgeWeight(direction: 1 | -1) {
    const current = weight.trim() === '' ? 0 : Number(weight);
    if (Number.isNaN(current)) return;
    const next = Math.max(0, roundToIncrement(current + direction * increment));
    if (next === set.weight) return;
    setWeight(formatWeight(next));
    onUpdate({ weight: next });
    flashSaved();
  }

  const hasNote = (set.notes ?? '').length > 0;

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-1.5 px-1">
        <span className="font-mono text-[11px] text-ink-500 w-4 shrink-0 text-center">
          {set.setNumber}
        </span>
        <input
          ref={primaryRef}
          type="number"
          inputMode="numeric"
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          onBlur={commit}
          placeholder="–"
          aria-label={`Set ${set.setNumber} ${isTime ? 'seconds' : 'reps'}`}
          className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded px-1 py-1.5 text-sm font-mono text-center focus:outline-none focus:border-accent/50"
        />
        <span className="text-ink-700 text-[10px] shrink-0">{isTime ? 's' : '×'}</span>
        {/* Stepper-flanked weight input. Buttons are tight so the trio reads as
            one control rather than three loose elements. */}
        <div className="flex-1 min-w-0 flex items-stretch border border-ink-800 rounded overflow-hidden bg-ink-950 focus-within:border-accent/50">
          <button
            type="button"
            onClick={() => nudgeWeight(-1)}
            className="w-7 shrink-0 text-ink-500 hover:text-ink-100 hover:bg-ink-900 transition flex items-center justify-center border-r border-ink-800"
            aria-label={`Decrease weight by ${increment}`}
            title={`-${increment}`}
          >
            <Minus size={12} />
          </button>
          <input
            ref={weightRef}
            type="number"
            inputMode="decimal"
            step={increment}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onBlur={commit}
            placeholder="–"
            aria-label={`Set ${set.setNumber} weight`}
            className="flex-1 min-w-0 bg-transparent px-0.5 py-1.5 text-sm font-mono text-center focus:outline-none"
          />
          <button
            type="button"
            onClick={() => nudgeWeight(1)}
            className="w-7 shrink-0 text-ink-500 hover:text-ink-100 hover:bg-ink-900 transition flex items-center justify-center border-l border-ink-800"
            aria-label={`Increase weight by ${increment}`}
            title={`+${increment}`}
          >
            <Plus size={12} />
          </button>
        </div>
        {/* Saved indicator — shows a check briefly after commit. Fixed-width slot
            so adjacent buttons don't shift when it appears/disappears. */}
        <div className="w-4 shrink-0 flex items-center justify-center">
          {justSaved && <Check size={14} className="accent-text" strokeWidth={2.5} />}
        </div>
        <button
          onClick={() => setNotesOpen((o) => !o)}
          className={`w-7 h-7 flex items-center justify-center transition shrink-0 rounded ${
            hasNote ? 'accent-text hover:brightness-110' : 'text-ink-600 hover:text-ink-100'
          }`}
          aria-label={`${hasNote ? 'Edit' : 'Add'} note for set ${set.setNumber}`}
          aria-expanded={notesOpen}
          title={hasNote ? 'Note' : 'Add a note'}
        >
          <StickyNote size={13} fill={hasNote ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center text-ink-600 hover:text-bad transition shrink-0 rounded"
          aria-label={`Remove set ${set.setNumber}`}
          title="Remove set"
        >
          <X size={13} />
        </button>
      </div>

      {/* Note expansion — single-line by default, grows to two lines on focus */}
      {notesOpen && (
        <div className="mt-1 ml-7 mr-1">
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

// Render an increment without trailing zeros: 5 → "5", 2.5 → "2.5".
function formatIncrement(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${n}`.replace(/\.?0+$/, '');
}

// Weight values are stored as Float — keep the input value clean by stripping
// the trailing ".0" Number.toString sometimes produces.
function formatWeight(weight: number | null): string {
  if (weight === null) return '';
  return Number.isInteger(weight) ? `${weight}` : `${weight}`;
}

// Small helper: snap a stepper-derived value back to the increment grid so
// repeated +/- presses don't accumulate float fuzz like 47.499999...
function roundToIncrement(value: number): number {
  return Math.round(value * 1000) / 1000;
}
