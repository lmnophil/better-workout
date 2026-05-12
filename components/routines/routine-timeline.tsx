'use client';

// Routine timeline — surfaces on the workout page when the user has a routine
// and no active session. Replaces (the upper portion of) the empty state with
// a recency + today + upcoming view, with tap-to-expand details for any day
// and per-exercise swap controls.

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Replace, Play } from 'lucide-react';
import {
  startFromRoutineDay,
  setPendingSwap,
  clearPendingSwap,
  swapInRoutineTemplate,
} from '@/lib/actions';
import { ExercisePicker } from '@/components/workout/exercise-picker';
import { WEEKDAY_FULL_LABELS, type ScheduleStyle } from '@/lib/routine';
import type { ExerciseInfo } from '@/components/workout/workout-view';
import { moduleDescription } from '@/lib/exercises-data';
import { usePrefs } from '@/components/ui/prefs-context';
import { estimatePlannedTotalSeconds, formatEstimate } from '@/lib/time-estimate';

export type RoutineDayExerciseClient = {
  exerciseId: string;
  name: string;
  module: string;
  position: number;
  // Planned dimensions used by the time estimator. plannedSets is the set
  // count; plannedReps applies for reps-metric exercises and plannedSeconds
  // for time-metric (planks, carries). All nullable when the slot was created
  // without a plan; the estimator falls back to its defaults.
  plannedSets: number | null;
  plannedReps: number | null;
  plannedSeconds: number | null;
  // If a one-time swap is staged, the *original* exercise stays here and
  // pendingSwap.inExerciseId/Name describes the substitution.
  pendingSwapInExerciseId?: string;
  pendingSwapInExerciseName?: string;
};

export type RoutineDayClient = {
  id: string;
  position: number;
  weekday: number | null;
  label: string | null;
  templateId: string;
  templateName: string;
  // Indicates the underlying template is a built-in (can't be edited
  // directly — permanent swap is disabled).
  templateIsBuiltin: boolean;
  exercises: RoutineDayExerciseClient[];
};

export type RoutineRecentSessionClient = {
  id: string;
  date: string; // ISO
  dayId: string | null;
  dayLabel: string | null;
  templateName: string | null;
  setCount: number;
};

export type RoutineTimelineProps = {
  routine: {
    name: string;
    description: string | null;
    scheduleStyle: ScheduleStyle;
  };
  todaysDay: RoutineDayClient | null;
  upcomingDays: RoutineDayClient[];
  recentSessions: RoutineRecentSessionClient[];
  availableExercises: ExerciseInfo[];
};

export function RoutineTimeline({
  routine,
  todaysDay,
  upcomingDays,
  recentSessions,
  availableExercises,
}: RoutineTimelineProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">
          Your routine
        </div>
        <div className="font-display text-2xl tracking-tight">{routine.name}</div>
        {routine.description && (
          <p className="text-xs text-ink-500 italic font-display mt-0.5">{routine.description}</p>
        )}
      </div>

      {recentSessions.length > 0 && <RecentSection sessions={recentSessions} />}

      <TodaySection
        scheduleStyle={routine.scheduleStyle}
        todaysDay={todaysDay}
        availableExercises={availableExercises}
      />

      {upcomingDays.length > 0 && (
        <UpcomingSection
          scheduleStyle={routine.scheduleStyle}
          days={upcomingDays}
          availableExercises={availableExercises}
        />
      )}
    </div>
  );
}

// ============ RECENT ============

function RecentSection({ sessions }: { sessions: RoutineRecentSessionClient[] }) {
  return (
    <div>
      <SectionHeader>Recent</SectionHeader>
      <div className="space-y-1">
        {sessions.map((s) => {
          const date = new Date(s.date);
          const dateLabel = date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });
          const dayName = s.templateName ?? '(removed from routine)';
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 px-3 py-2 bg-ink-900/30 rounded-lg"
            >
              <div className="text-[11px] text-ink-500 font-mono w-12 shrink-0">{dateLabel}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-100 truncate">{dayName}</div>
                {s.dayLabel && (
                  <div className="text-[11px] text-ink-500 italic font-display truncate">
                    {s.dayLabel}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-ink-500 shrink-0">
                {s.setCount} {s.setCount === 1 ? 'set' : 'sets'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ TODAY ============

function TodaySection({
  scheduleStyle,
  todaysDay,
  availableExercises,
}: {
  scheduleStyle: ScheduleStyle;
  todaysDay: RoutineDayClient | null;
  availableExercises: ExerciseInfo[];
}) {
  return (
    <div>
      <SectionHeader>{scheduleStyle === 'weekday' ? 'Today' : 'Up next'}</SectionHeader>
      {todaysDay ? (
        <DayCard
          day={todaysDay}
          isToday={true}
          defaultExpanded={true}
          availableExercises={availableExercises}
        />
      ) : (
        <div className="px-4 py-6 border border-ink-800 rounded-lg text-center">
          <div className="text-sm text-ink-300">
            {scheduleStyle === 'weekday' ? 'Nothing pinned for today.' : 'No days yet.'}
          </div>
          <div className="text-[11px] text-ink-500 italic font-display mt-1">
            {scheduleStyle === 'weekday'
              ? 'Pick something below or build ad-hoc.'
              : 'Add days to your routine in settings.'}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ UPCOMING ============

function UpcomingSection({
  scheduleStyle,
  days,
  availableExercises,
}: {
  scheduleStyle: ScheduleStyle;
  days: RoutineDayClient[];
  availableExercises: ExerciseInfo[];
}) {
  return (
    <div>
      <SectionHeader>{scheduleStyle === 'weekday' ? 'Coming up' : 'Then'}</SectionHeader>
      <div className="space-y-1.5">
        {days.map((d, idx) => (
          <DayCard
            key={d.id}
            day={d}
            isToday={false}
            defaultExpanded={false}
            availableExercises={availableExercises}
            // Sequence mode: mark the last upcoming entry as the loop indicator.
            isLoopBack={scheduleStyle === 'sequence' && idx === days.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ============ DAY CARD ============

function DayCard({
  day,
  isToday,
  defaultExpanded,
  availableExercises,
  isLoopBack,
}: {
  day: RoutineDayClient;
  isToday: boolean;
  defaultExpanded: boolean;
  availableExercises: ExerciseInfo[];
  isLoopBack?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { prefs } = usePrefs();

  // Estimated time for this day. Walks the day's exercise lineup, applying
  // any staged one-time swaps so the surfaced number matches what the user
  // will actually start with. Per-exercise rest comes from the user's
  // override, or falls back to the global preference.
  const exerciseById = new Map(availableExercises.map((e) => [e.id, e]));
  const dayPlannedExercises = day.exercises.flatMap((e) => {
    const effectiveId = e.pendingSwapInExerciseId ?? e.exerciseId;
    const ex = exerciseById.get(effectiveId);
    if (!ex) return [];
    return [
      {
        metric: ex.metric,
        restSeconds: ex.restTimerSecondsOverride ?? prefs.restTimerSeconds,
        plannedSets: e.plannedSets,
        plannedReps: e.plannedReps,
        plannedSeconds: e.plannedSeconds,
      },
    ];
  });
  const dayEstimateSec = estimatePlannedTotalSeconds(dayPlannedExercises);

  // Picker open for swap. Holds the outgoing exercise's id+name so the
  // picker can show the right title and the post-pick choice dialog can
  // describe what's being swapped.
  const [pickerSwap, setPickerSwap] = useState<{
    outExerciseId: string;
    outExerciseName: string;
  } | null>(null);
  // After a pick, holds the (out, in) tuple while waiting for the user to
  // choose one-time vs permanent.
  const [pendingChoice, setPendingChoice] = useState<{
    outExerciseId: string;
    outExerciseName: string;
    inExerciseId: string;
    inExerciseName: string;
  } | null>(null);

  const hasPendingSwaps = day.exercises.some((e) => e.pendingSwapInExerciseId);

  function handleStart() {
    setError(null);
    startTransition(async () => {
      try {
        await startFromRoutineDay({ routineDayId: day.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start workout.');
      }
    });
  }

  function openSwap(exerciseId: string, exerciseName: string) {
    setPickerSwap({ outExerciseId: exerciseId, outExerciseName: exerciseName });
  }

  function handleSwapPicked(newExerciseId: string) {
    if (!pickerSwap) return;
    const newExercise = availableExercises.find((e) => e.id === newExerciseId);
    if (!newExercise) return;
    setPendingChoice({
      outExerciseId: pickerSwap.outExerciseId,
      outExerciseName: pickerSwap.outExerciseName,
      inExerciseId: newExerciseId,
      inExerciseName: newExercise.name,
    });
    setPickerSwap(null);
  }

  function commitOneTime() {
    if (!pendingChoice) return;
    setError(null);
    startTransition(async () => {
      try {
        await setPendingSwap({
          routineDayId: day.id,
          outExerciseId: pendingChoice.outExerciseId,
          inExerciseId: pendingChoice.inExerciseId,
        });
        setPendingChoice(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save swap.');
      }
    });
  }

  function commitPermanent() {
    if (!pendingChoice) return;
    if (day.templateIsBuiltin) {
      setError(
        'This day uses a default template, which can’t be edited directly. Build your own copy first.',
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await swapInRoutineTemplate({
          routineDayId: day.id,
          outExerciseId: pendingChoice.outExerciseId,
          inExerciseId: pendingChoice.inExerciseId,
        });
        setPendingChoice(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save swap.');
      }
    });
  }

  function clearOneTime(outExerciseId: string) {
    startTransition(() => {
      clearPendingSwap({ routineDayId: day.id, outExerciseId });
    });
  }

  // The set of exercise ids effectively "in" this day (originals or their
  // pending replacements). Passed to the picker so it doesn't list things
  // already in the day as swap candidates.
  const effectiveInDay = new Set<string>();
  for (const e of day.exercises) {
    effectiveInDay.add(e.pendingSwapInExerciseId ?? e.exerciseId);
  }

  const weekdayLabel =
    day.weekday !== null && day.weekday !== undefined ? WEEKDAY_FULL_LABELS[day.weekday] : null;

  return (
    <div
      className={`border rounded-lg ${isToday ? 'accent-border bg-ink-900/40' : 'border-ink-800'}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-start justify-between gap-3 text-left"
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {expanded ? (
            <ChevronDown size={14} className="text-ink-500 mt-1 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-ink-500 mt-1 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm text-ink-100 flex items-center gap-2 flex-wrap">
              <span>{day.templateName}</span>
              {hasPendingSwaps && (
                <span className="text-[9px] tracking-[0.2em] uppercase accent-text">
                  · swap staged
                </span>
              )}
              {isLoopBack && (
                <span className="text-[9px] tracking-[0.2em] uppercase text-ink-500">
                  · loops back
                </span>
              )}
            </div>
            <div className="text-[11px] text-ink-500 mt-0.5 truncate">
              {[
                weekdayLabel,
                day.label,
                `${day.exercises.length} ${day.exercises.length === 1 ? 'exercise' : 'exercises'}`,
                dayEstimateSec > 0 ? `~${formatEstimate(dayEstimateSec)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 -mt-1 space-y-3">
          <ExerciseList
            exercises={day.exercises}
            disabled={isPending}
            onSwap={openSwap}
            onClearOneTime={clearOneTime}
          />

          {error && <p className="text-[11px] text-bad">{error}</p>}

          <div className="flex justify-end">
            <button
              onClick={handleStart}
              disabled={isPending}
              className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Play size={13} strokeWidth={3} />
              Start this workout
            </button>
          </div>
        </div>
      )}

      {pickerSwap && (
        <ExercisePicker
          availableExercises={availableExercises}
          excludeIds={effectiveInDay}
          onPickMany={() => {}} // unused in swap mode
          onClose={() => setPickerSwap(null)}
          onCreateCustom={() => {}}
          onDeleteCustom={() => {}}
          swap={{
            targetName: pickerSwap.outExerciseName,
            onPick: handleSwapPicked,
          }}
        />
      )}

      {pendingChoice && (
        <SwapChoiceDialog
          choice={pendingChoice}
          permanentDisabled={day.templateIsBuiltin}
          onOneTime={commitOneTime}
          onPermanent={commitPermanent}
          onCancel={() => setPendingChoice(null)}
          isPending={isPending}
        />
      )}
    </div>
  );
}

// ============ EXERCISE LIST (within day) ============

function ExerciseList({
  exercises,
  disabled,
  onSwap,
  onClearOneTime,
}: {
  exercises: RoutineDayExerciseClient[];
  disabled: boolean;
  onSwap: (id: string, name: string) => void;
  onClearOneTime: (outExerciseId: string) => void;
}) {
  if (exercises.length === 0) {
    return (
      <p className="text-[11px] text-ink-500 italic font-display">No exercises in this template.</p>
    );
  }
  // Group by module like the active session does — reads as the same
  // chunked workout the user will see when they start it.
  const elements: React.ReactNode[] = [];
  let lastModule: string | null = null;
  exercises.forEach((ex, idx) => {
    if (ex.module !== lastModule) {
      const description = moduleDescription(ex.module);
      elements.push(
        <div key={`hdr-${idx}`} className="pt-2 first:pt-0">
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">{ex.module}</div>
          {description && (
            <div className="text-[10px] text-ink-600 italic font-display leading-snug mt-0.5">
              {description}
            </div>
          )}
        </div>,
      );
      lastModule = ex.module;
    }
    const swapped = !!ex.pendingSwapInExerciseId;
    elements.push(
      <div key={`${ex.exerciseId}-${idx}`} className="flex items-center justify-between gap-2 py-1">
        <div className="text-sm text-ink-100 min-w-0 flex items-center gap-2 flex-wrap">
          {swapped ? (
            <>
              <span className="line-through text-ink-600">{ex.name}</span>
              <span className="text-ink-500">→</span>
              <span>{ex.pendingSwapInExerciseName}</span>
              <span className="text-[9px] tracking-[0.2em] uppercase accent-text">one-time</span>
            </>
          ) : (
            <span>{ex.name}</span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {swapped ? (
            <button
              onClick={() => onClearOneTime(ex.exerciseId)}
              disabled={disabled}
              className="text-ink-500 hover:text-ink-100 transition p-1 disabled:opacity-50"
              aria-label="Revert one-time swap"
              title="Revert"
            >
              <RotateCcw size={13} />
            </button>
          ) : (
            <button
              onClick={() => onSwap(ex.exerciseId, ex.name)}
              disabled={disabled}
              className="text-ink-500 hover:text-ink-100 transition p-1 disabled:opacity-50"
              aria-label={`Swap ${ex.name}`}
              title="Swap"
            >
              <Replace size={13} />
            </button>
          )}
        </div>
      </div>,
    );
  });
  return <div>{elements}</div>;
}

// ============ SWAP CHOICE DIALOG ============

function SwapChoiceDialog({
  choice,
  permanentDisabled,
  onOneTime,
  onPermanent,
  onCancel,
  isPending,
}: {
  choice: {
    outExerciseName: string;
    inExerciseName: string;
  };
  permanentDisabled: boolean;
  onOneTime: () => void;
  onPermanent: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center"
      onClick={() => !isPending && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-ink-950 border border-ink-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md sm:mx-4 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-display text-xl">How long should this swap last?</h3>
          <p className="text-xs text-ink-500 italic font-display mt-1">
            <span className="text-ink-300">{choice.outExerciseName}</span>
            {' → '}
            <span className="text-ink-100">{choice.inExerciseName}</span>
          </p>
        </div>

        <button
          onClick={onOneTime}
          disabled={isPending}
          className="w-full text-left border border-ink-800 hover:border-accent/40 rounded-lg p-3 transition disabled:opacity-50"
        >
          <div className="text-sm text-ink-100">Just next time</div>
          <div className="text-[11px] text-ink-500 italic font-display mt-0.5">
            The swap applies the next time you start this day, then clears. Doesn&apos;t change the
            underlying template.
          </div>
        </button>

        <button
          onClick={onPermanent}
          disabled={isPending || permanentDisabled}
          className="w-full text-left border border-ink-800 hover:border-accent/40 rounded-lg p-3 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="text-sm text-ink-100">Going forward</div>
          <div className="text-[11px] text-ink-500 italic font-display mt-0.5">
            {permanentDisabled
              ? 'This day uses a default template, so going-forward edits aren’t available here. Use one-time, or build your own template.'
              : 'Edit the template so this swap applies every time, including future routine days that use it.'}
          </div>
        </button>

        <div className="flex justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="px-3 py-1.5 text-xs tracking-wider uppercase text-ink-300 hover:text-ink-100 transition disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ SECTION HEADER ============

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">{children}</div>
  );
}
