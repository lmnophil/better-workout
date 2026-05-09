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
  ChevronDown,
  ChevronUp,
  Plus,
  Replace,
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
  removeExerciseFromRoutineDay,
  removeRoutineDay,
  reorderRoutineDay,
  reorderRoutineDayExercise,
  swapInRoutineTemplate,
  updateRoutine,
  updateRoutineDay,
} from '@/lib/actions';
import {
  MAX_ROUTINE_DAYS,
  WEEKDAY_FULL_LABELS,
  WEEKDAY_LABELS,
  type ScheduleStyle,
} from '@/lib/routine';
import { ExercisePicker } from '@/components/workout/exercise-picker';
import type { ExerciseInfo } from '@/components/workout/workout-view';
import { useConfirm } from '@/components/ui/use-confirm';

// ============ TYPES ============

// Slim shape used by DayCard. Live mode synthesizes this from the server
// data; Draft mode synthesizes it from local state.
type DayExercise = {
  exerciseId: string;
  name: string;
  module: string;
};

type EditorDay = {
  id: string;
  name: string;
  label: string | null;
  weekday: number | null;
  exercises: DayExercise[];
};

export type DayClient = {
  id: string;
  position: number;
  weekday: number | null;
  label: string | null;
  name: string;
  exercises: {
    templateExerciseId: string;
    exerciseId: string;
    name: string;
    module: string;
    position: number;
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

type Props = {
  routine: RoutineClient | null;
  seedTemplates: SeedTemplateClient[];
  availableExercises: ExerciseInfo[];
};

// ============ TOP-LEVEL DISPATCH ============

export function RoutineEditor({ routine, seedTemplates, availableExercises }: Props) {
  return (
    <div className="px-5 pt-6 pb-24">
      <Header />
      {routine ? (
        <LiveEditor
          routine={routine}
          seedTemplates={seedTemplates}
          availableExercises={availableExercises}
        />
      ) : (
        <DraftEditor
          seedTemplates={seedTemplates}
          availableExercises={availableExercises}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6">
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">
        Plan
      </div>
      <h1
        className="font-display text-3xl tracking-tight"
        style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
      >
        Routine
      </h1>
      <p className="text-sm text-ink-400 italic font-display mt-1 leading-relaxed">
        Your cycle of templates &mdash; the structure you tell the app, not a
        plan it gives you.
      </p>
    </div>
  );
}

// ============ DRAFT EDITOR ============

type DraftDay = {
  // Stable client id for React keys and dispatch. Replaced with a server id
  // once the routine is saved (then the user enters Live mode).
  clientId: string;
  name: string;
  label: string | null;
  weekday: number | null;
  exerciseIds: string[];
};

function makeDraftDay(initial: Partial<DraftDay> = {}): DraftDay {
  return {
    clientId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    name: '',
    label: null,
    weekday: null,
    exerciseIds: [],
    ...initial,
  };
}

function DraftEditor({
  seedTemplates,
  availableExercises,
}: {
  seedTemplates: SeedTemplateClient[];
  availableExercises: ExerciseInfo[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [scheduleStyle, setScheduleStyle] = useState<ScheduleStyle>('sequence');
  const [days, setDays] = useState<DraftDay[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerForDayClientId, setPickerForDayClientId] = useState<string | null>(null);

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
        const fallback =
          d.weekday !== null ? WEEKDAY_FULL_LABELS[d.weekday] : `Day ${idx + 1}`;
        return {
          id: d.clientId,
          name: d.name.trim() || fallback,
          label: d.label,
          weekday: d.weekday,
          exercises: d.exerciseIds
            .map((id) => exerciseById.get(id))
            .filter((e): e is ExerciseInfo => e !== undefined)
            .map((e) => ({ exerciseId: e.id, name: e.name, module: e.module })),
        };
      }),
    [days, exerciseById],
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

  function seedFromTemplate(clientId: string, templateId: string) {
    const tpl = seedTemplateById.get(templateId);
    if (!tpl) return;
    // Find the matching exercise ids: templates surface exercise *names*, but
    // we need ids to populate the day. Cross-reference by name against the
    // available exercises — this is exact-match because both lists come from
    // the same Exercise table.
    const nameToId = new Map(availableExercises.map((e) => [e.name, e.id]));
    const ids = tpl.exerciseNames
      .map((n) => nameToId.get(n))
      .filter((id): id is string => id !== undefined);
    updateDay(clientId, (d) => ({
      ...d,
      // Default the day's name to the seed's, but only if the user hasn't
      // typed something already.
      name: d.name.trim() ? d.name : tpl.name,
      exerciseIds: ids,
    }));
  }

  // The valid-to-save predicate: at least one day, every day has at least
  // one exercise, every weekday-pinned day in calendar mode has a unique
  // weekday. Schedule-style switching can leave weekday=null on cycle days
  // — that's fine because we strip weekdays in sequence mode anyway.
  const canSave = useMemo(() => {
    if (days.length === 0) return false;
    if (days.some((d) => d.exerciseIds.length === 0)) return false;
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
            exerciseIds: d.exerciseIds,
            label: d.label?.trim() || undefined,
            weekday: scheduleStyle === 'weekday' ? d.weekday : null,
          })),
        });
        router.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Could not save routine.');
      }
    });
  }

  return (
    <>
      <ScheduleToggle
        value={scheduleStyle}
        onChange={(s) => setScheduleStyle(s)}
        // Switching mode leaves the days but clears weekday pins so the
        // user re-pins from scratch in calendar. We do the clear in both
        // directions to keep the data clean.
        onSwitchSideEffect={() =>
          setDays((prev) => prev.map((d) => ({ ...d, weekday: null })))
        }
      />

      <div className="mt-5">
        <DaysSection
          mode="draft"
          scheduleStyle={scheduleStyle}
          days={editorDays}
          atCap={days.length >= MAX_ROUTINE_DAYS}
          isPending={isPending}
          seedTemplates={seedTemplates}
          onAddDay={addDay}
          onRenameDay={(id, name) =>
            updateDay(id, (d) => ({ ...d, name }))
          }
          onSetWeekday={(id, weekday) =>
            updateDay(id, (d) => ({ ...d, weekday }))
          }
          onRemoveDay={removeDay}
          onMoveDay={moveDay}
          onOpenExercisePicker={setPickerForDayClientId}
          onSeedFromTemplate={seedFromTemplate}
          onRemoveExercise={(id, exerciseId) =>
            updateDay(id, (d) => ({
              ...d,
              exerciseIds: d.exerciseIds.filter((eid) => eid !== exerciseId),
            }))
          }
          onReorderExercise={(id, exerciseId, direction) =>
            updateDay(id, (d) => {
              const idx = d.exerciseIds.indexOf(exerciseId);
              if (idx < 0) return d;
              const target = direction === 'up' ? idx - 1 : idx + 1;
              if (target < 0 || target >= d.exerciseIds.length) return d;
              const next = [...d.exerciseIds];
              [next[idx], next[target]] = [next[target], next[idx]];
              return { ...d, exerciseIds: next };
            })
          }
          onSwapExercise={null}
        />
      </div>

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

      {pickerForDayClientId &&
        (() => {
          const draftDay = days.find((d) => d.clientId === pickerForDayClientId);
          if (!draftDay) return null;
          const excludeIds = new Set(draftDay.exerciseIds);
          return (
            <ExercisePicker
              availableExercises={availableExercises}
              excludeIds={excludeIds}
              onPickMany={(exerciseIds) => {
                setPickerForDayClientId(null);
                updateDay(draftDay.clientId, (d) => ({
                  ...d,
                  exerciseIds: [
                    ...d.exerciseIds,
                    ...exerciseIds.filter((id) => !d.exerciseIds.includes(id)),
                  ],
                }));
              }}
              onClose={() => setPickerForDayClientId(null)}
              onCreateCustom={(name, primary, secondary, prescription, videoUrl, restTimerSeconds) => {
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

// ============ LIVE EDITOR ============

function LiveEditor({
  routine,
  seedTemplates,
  availableExercises,
}: {
  routine: RoutineClient;
  seedTemplates: SeedTemplateClient[];
  availableExercises: ExerciseInfo[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, Dialog: ConfirmDialog } = useConfirm();

  const [pickerForDayId, setPickerForDayId] = useState<string | null>(null);
  const [swapForDay, setSwapForDay] = useState<
    { dayId: string; outExerciseId: string } | null
  >(null);

  const editorDays: EditorDay[] = useMemo(
    () =>
      [...routine.days]
        .sort((a, b) => a.position - b.position)
        .map((d) => ({
          id: d.id,
          name: d.name,
          label: d.label,
          weekday: d.weekday,
          exercises: d.exercises
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((e) => ({
              exerciseId: e.exerciseId,
              name: e.name,
              module: e.module,
            })),
        })),
    [routine.days],
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
        onSwapExercise={(id, exerciseId) =>
          setSwapForDay({ dayId: id, outExerciseId: exerciseId })
        }
      />

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
              onCreateCustom={(name, primary, secondary, prescription, videoUrl, restTimerSeconds) => {
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
              onCreateCustom={(name, primary, secondary, prescription, videoUrl, restTimerSeconds) => {
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
      updateRoutine({ description: next }).catch(() =>
        setDescription(routine.description ?? ''),
      );
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
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400">
          Schedule style
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
  onRemoveDay: (id: string) => void;
  onMoveDay: (id: string, direction: 'up' | 'down') => void;
  onOpenExercisePicker: (id: string) => void;
  onSeedFromTemplate: (id: string, templateId: string) => void;
  onRemoveExercise: (id: string, exerciseId: string) => void;
  onReorderExercise: (id: string, exerciseId: string, direction: 'up' | 'down') => void;
  // Null disables the swap button (e.g. in draft mode).
  onSwapExercise: ((id: string, exerciseId: string) => void) | null;
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
            These days don&apos;t have a weekday yet. Pick one in each card or
            remove the day.
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
                <span className="font-mono text-[11px] text-ink-500 w-9">
                  {WEEKDAY_LABELS[wd]}
                </span>
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
    onRemove: p.onRemoveDay,
    onMove: p.onMoveDay,
    onOpenExercisePicker: p.onOpenExercisePicker,
    onSeedFromTemplate: p.onSeedFromTemplate,
    onRemoveExercise: p.onRemoveExercise,
    onReorderExercise: p.onReorderExercise,
    onSwapExercise: p.onSwapExercise,
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
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onOpenExercisePicker: (id: string) => void;
  onSeedFromTemplate: (id: string, templateId: string) => void;
  onRemoveExercise: (id: string, exerciseId: string) => void;
  onReorderExercise: (id: string, exerciseId: string, direction: 'up' | 'down') => void;
  onSwapExercise: ((id: string, exerciseId: string) => void) | null;
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
  onRemove,
  onMove,
  onOpenExercisePicker,
  onSeedFromTemplate,
  onRemoveExercise,
  onReorderExercise,
  onSwapExercise,
}: DayCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(day.name);
  // Keep the local input in sync with upstream changes (e.g. seed-from-template
  // updating the day's name).
  useEffect(() => {
    setName(day.name);
  }, [day.name]);

  const takenWeekdays = new Set(
    allDays
      .filter((d) => d.id !== day.id && d.weekday !== null)
      .map((d) => d.weekday as number),
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
              className="text-sm text-ink-100 hover:text-accent transition truncate text-left flex-1 min-w-0"
            >
              {day.name}
            </button>
          )}
        </div>
        <button
          onClick={() => onRemove(day.id)}
          disabled={isPending}
          className="text-ink-500 hover:text-bad transition shrink-0 ml-2"
          aria-label="Remove day"
        >
          <Trash2 size={13} />
        </button>
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

        {day.exercises.length > 0 ? (
          <div className="space-y-1">
            {day.exercises.map((ex, idx) => (
              <ExerciseRow
                key={ex.exerciseId}
                exercise={ex}
                canMoveUp={idx > 0}
                canMoveDown={idx < day.exercises.length - 1}
                isPending={isPending}
                onRemove={() => onRemoveExercise(day.id, ex.exerciseId)}
                onMove={(dir) => onReorderExercise(day.id, ex.exerciseId, dir)}
                onSwap={
                  onSwapExercise
                    ? () => onSwapExercise(day.id, ex.exerciseId)
                    : null
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-ink-500 italic font-display py-1">
            No exercises yet.
          </p>
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
          {t.name} ({t.exerciseNames.length})
          {t.isBuiltin ? ' · default' : ''}
        </option>
      ))}
    </select>
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
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1.5">
        Weekday
      </div>
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
}: {
  exercise: DayExercise;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isPending: boolean;
  onSwap: (() => void) | null;
  onRemove: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <div className="bg-ink-900/40 border border-ink-900 rounded px-2.5 py-2 flex items-center gap-2">
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
        <div className="text-[13px] text-ink-100 truncate">{exercise.name}</div>
        <div className="text-[10px] text-ink-500 truncate">{exercise.module}</div>
      </div>
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
