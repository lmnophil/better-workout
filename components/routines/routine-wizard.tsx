'use client';

// Build-a-routine wizard. Three-step flow reached from the workout-page CTA
// when the user has no routine. Holds the entire draft in client state and
// only writes to the DB on the final submit (createRoutineFromDraft is a
// single transaction). Bailing out at any step leaves no orphan rows.
//
// Step 1: name + schedule style
// Step 2: build days — pick existing templates or author new ones inline,
//         with a coverage panel that updates as the routine takes shape
// Step 3: review + create
//
// Coverage panel notes: in weekday mode each day fires once per week so we
// show real "sets/week vs target" with gap detection. In sequence mode we
// don't know the user's cadence — we show "sets per cycle" with a soft
// caveat. Muscles with zero work are flagged regardless of mode.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { createRoutineFromDraft } from '@/lib/actions';
import {
  MAX_ROUTINE_DAYS,
  WEEKDAY_LABELS,
  WEEKDAY_FULL_LABELS,
  type ScheduleStyle,
} from '@/lib/routine';
import {
  computeRoutineCoverage,
  type CoverageStat,
  type DraftDay as CoverageDraftDay,
} from '@/lib/routine-coverage';
import type { ExerciseInfo } from '@/components/workout/workout-view';
import { ExercisePicker } from '@/components/workout/exercise-picker';
import {
  createCustomExercise,
  deleteCustomExercise,
} from '@/lib/actions';
import { useConfirm } from '@/components/ui/use-confirm';

// ============ TYPES ============

export type WizardTemplateOption = {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  exercises: { exerciseId: string; name: string }[];
};

type DraftExerciseInDay = {
  exerciseId: string;
  plannedSets: number;
};

type DraftDayShared = {
  // Stable client-side id for React keys and picker scoping.
  clientId: string;
  label: string;
  weekday: number | null;
};

type DraftDayExisting = DraftDayShared & {
  kind: 'existing';
  templateId: string | null;
};

type DraftDayNew = DraftDayShared & {
  kind: 'new';
  templateName: string;
  exercises: DraftExerciseInDay[];
};

type DraftDay = DraftDayExisting | DraftDayNew;

type Props = {
  availableExercises: ExerciseInfo[];
  templates: WizardTemplateOption[];
  volumeTargets: Record<string, number>;
};

const DEFAULT_SETS = 3;

// ============ COMPONENT ============

export function RoutineWizard({ availableExercises, templates, volumeTargets }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, Dialog: ConfirmDialog } = useConfirm();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleStyle, setScheduleStyle] = useState<ScheduleStyle>('sequence');
  const [days, setDays] = useState<DraftDay[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Picker scoping: which day's "Build new" tab is the picker open for?
  // Lifted to the top so the picker has access to startTransition / router
  // for custom-exercise create/delete (which need a manual refresh on this
  // route since the action only revalidates '/').
  const [pickerForDay, setPickerForDay] = useState<string | null>(null);

  const targetsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(volumeTargets)) m.set(k, v);
    return m;
  }, [volumeTargets]);

  const exerciseById = useMemo(
    () => new Map(availableExercises.map((e) => [e.id, e])),
    [availableExercises],
  );
  const templatesById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates],
  );

  // Project draft days into the coverage helper's shape. Existing-template
  // days inherit the template's exercises with DEFAULT_SETS each (the user
  // didn't author them inline, so we don't have per-exercise set counts —
  // the default is the same fallback we'd use elsewhere).
  const coverageDays: CoverageDraftDay[] = useMemo(() => {
    return days.map((d) => {
      if (d.kind === 'existing') {
        const tpl = d.templateId ? templatesById.get(d.templateId) : null;
        if (!tpl) return { exercises: [] };
        return {
          exercises: tpl.exercises
            .map((te) => exerciseById.get(te.exerciseId))
            .filter((e): e is ExerciseInfo => e !== undefined)
            .map((e) => ({
              primaryMuscles: e.primaryMuscles,
              secondaryMuscles: e.secondaryMuscles,
              plannedSets: DEFAULT_SETS,
            })),
        };
      }
      // 'new' template: use the user's per-exercise set counts.
      return {
        exercises: d.exercises
          .map((dei) => ({ exercise: exerciseById.get(dei.exerciseId), sets: dei.plannedSets }))
          .filter((p): p is { exercise: ExerciseInfo; sets: number } => p.exercise !== undefined)
          .map((p) => ({
            primaryMuscles: p.exercise.primaryMuscles,
            secondaryMuscles: p.exercise.secondaryMuscles,
            plannedSets: p.sets,
          })),
      };
    });
  }, [days, exerciseById, templatesById]);

  const coverage = useMemo(
    () => computeRoutineCoverage(coverageDays, scheduleStyle, targetsMap),
    [coverageDays, scheduleStyle, targetsMap],
  );

  // Validation gates per step. Step 1 requires a name. Step 2 requires at
  // least one day, every day must have a real selection (existing template
  // chosen, or new template with name + exercises).
  const step1Valid = name.trim().length > 0;
  const step2Valid =
    days.length > 0 &&
    days.every((d) => {
      if (d.kind === 'existing') return d.templateId !== null;
      return d.templateName.trim().length > 0 && d.exercises.length > 0;
    });

  function addDay(weekday: number | null) {
    if (days.length >= MAX_ROUTINE_DAYS) return;
    const nextDayLabel = `Day ${days.length + 1}`;
    setDays((prev) => [
      ...prev,
      {
        clientId: crypto.randomUUID(),
        kind: 'new',
        templateName: nextDayLabel,
        exercises: [],
        label: '',
        weekday,
      },
    ]);
  }

  function updateDay(clientId: string, patch: (d: DraftDay) => DraftDay) {
    setDays((prev) => prev.map((d) => (d.clientId === clientId ? patch(d) : d)));
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

  async function handleSubmit() {
    setSubmitError(null);
    // Translate draft → action payload. Filter out any day that somehow
    // sneaks through validation in an incomplete state — defensive; UI
    // gates should prevent it.
    const payloadDays = days
      .map((d) => {
        if (d.kind === 'existing') {
          if (!d.templateId) return null;
          return {
            kind: 'existing' as const,
            templateId: d.templateId,
            label: d.label.trim() || undefined,
            weekday: scheduleStyle === 'weekday' ? d.weekday : null,
          };
        }
        if (d.exercises.length === 0 || d.templateName.trim().length === 0) return null;
        return {
          kind: 'new' as const,
          templateName: d.templateName.trim(),
          exerciseIds: d.exercises.map((e) => e.exerciseId),
          label: d.label.trim() || undefined,
          weekday: scheduleStyle === 'weekday' ? d.weekday : null,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    startTransition(async () => {
      try {
        await createRoutineFromDraft({
          name: name.trim(),
          description: description.trim() || undefined,
          scheduleStyle,
          days: payloadDays,
        });
        // Success — return the user to home where the routine timeline
        // now leads the empty state.
        router.push('/');
        router.refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Could not create routine.');
      }
    });
  }

  async function handleCancel() {
    if (name || description || days.length > 0) {
      const ok = await confirm({
        title: 'Leave the wizard?',
        message: 'Your draft routine will be lost.',
        confirmLabel: 'Leave',
        variant: 'danger',
      });
      if (!ok) return;
    }
    router.push('/');
  }

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <button
          onClick={handleCancel}
          className="text-[10px] tracking-[0.25em] uppercase text-ink-500 hover:text-ink-200 transition flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft size={11} /> Back to home
        </button>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1
            className="font-display text-3xl tracking-tight"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
          >
            Build a routine
          </h1>
          <span className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
            Step {step} of 3
          </span>
        </div>
        <p className="text-sm text-ink-400 italic font-display mt-1">
          A routine is your cycle of templates &mdash; the structure you tell the
          app, not a plan it gives you.
        </p>
      </div>

      <div className="px-5">
        {step === 1 && (
          <Step1NameSchedule
            name={name}
            description={description}
            scheduleStyle={scheduleStyle}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onScheduleChange={setScheduleStyle}
            canAdvance={step1Valid}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <Step2Days
            days={days}
            scheduleStyle={scheduleStyle}
            templates={templates}
            exerciseById={exerciseById}
            templatesById={templatesById}
            coverage={coverage}
            onAddDay={addDay}
            onUpdateDay={updateDay}
            onRemoveDay={removeDay}
            onMoveDay={moveDay}
            onOpenPicker={(clientId) => setPickerForDay(clientId)}
            canAdvance={step2Valid}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <Step3Review
            name={name}
            description={description}
            scheduleStyle={scheduleStyle}
            days={days}
            templatesById={templatesById}
            exerciseById={exerciseById}
            coverage={coverage}
            isPending={isPending}
            submitError={submitError}
            onBack={() => setStep(2)}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {pickerForDay && (() => {
        const day = days.find(
          (d) => d.clientId === pickerForDay && d.kind === 'new',
        ) as DraftDayNew | undefined;
        if (!day) return null;
        return (
          <ExercisePicker
            availableExercises={availableExercises}
            excludeIds={new Set(day.exercises.map((e) => e.exerciseId))}
            onPickMany={(exerciseIds) => {
              updateDay(day.clientId, (d) => {
                if (d.kind !== 'new') return d;
                const existingIds = new Set(d.exercises.map((e) => e.exerciseId));
                const additions = exerciseIds
                  .filter((id) => !existingIds.has(id))
                  .map((id) => ({ exerciseId: id, plannedSets: DEFAULT_SETS }));
                return { ...d, exercises: [...d.exercises, ...additions] };
              });
              setPickerForDay(null);
            }}
            onClose={() => setPickerForDay(null)}
            onCreateCustom={(name, primary, secondary, prescription, videoUrl, restTimerSeconds) => {
              // createCustomExercise's revalidatePath targets '/', not this
              // wizard route, so we manually refresh after to pull the new
              // custom into availableExercises.
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
    </div>
  );
}

// ============ STEP 1 ============

function Step1NameSchedule({
  name,
  description,
  scheduleStyle,
  onNameChange,
  onDescriptionChange,
  onScheduleChange,
  canAdvance,
  onNext,
}: {
  name: string;
  description: string;
  scheduleStyle: ScheduleStyle;
  onNameChange: (s: string) => void;
  onDescriptionChange: (s: string) => void;
  onScheduleChange: (s: ScheduleStyle) => void;
  canAdvance: boolean;
  onNext: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="border border-ink-800 rounded-lg p-4 space-y-4">
        <div>
          <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Edwardo's program"
            autoFocus
            className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
          />
        </div>

        <div>
          <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
            What's it for? <span className="text-ink-600">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="A note to your future self"
            className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      <div className="border border-ink-800 rounded-lg p-4">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400 mb-2">
          How does it cycle?
        </div>
        <div className="space-y-1.5">
          <ScheduleStyleOption
            active={scheduleStyle === 'sequence'}
            onClick={() => onScheduleChange('sequence')}
            title="Cycle"
            description="Self-paced rotation. After each completed routine workout, the next day in your cycle becomes today."
          />
          <ScheduleStyleOption
            active={scheduleStyle === 'weekday'}
            onClick={() => onScheduleChange('weekday')}
            title="Calendar"
            description="Pin each day to a specific weekday. Skipping a day in real life means skipping it; rest days are weekdays you don't pin."
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!canAdvance}
          className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function ScheduleStyleOption({
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
      className={`w-full text-left border rounded-lg px-3 py-2.5 transition ${
        active ? 'border-accent bg-accent/5' : 'border-ink-800 hover:border-ink-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-3 h-3 rounded-full border ${
            active ? 'accent-bg border-transparent' : 'border-ink-600'
          }`}
        />
        <span className="text-sm text-ink-100">{title}</span>
      </div>
      <div className="text-[11px] text-ink-500 italic font-display mt-0.5 ml-5 leading-relaxed">
        {description}
      </div>
    </button>
  );
}

// ============ STEP 2 — DAYS ============

function Step2Days({
  days,
  scheduleStyle,
  templates,
  exerciseById,
  templatesById,
  coverage,
  onAddDay,
  onUpdateDay,
  onRemoveDay,
  onMoveDay,
  onOpenPicker,
  canAdvance,
  onBack,
  onNext,
}: {
  days: DraftDay[];
  scheduleStyle: ScheduleStyle;
  templates: WizardTemplateOption[];
  exerciseById: Map<string, ExerciseInfo>;
  templatesById: Map<string, WizardTemplateOption>;
  coverage: CoverageStat[];
  onAddDay: (weekday: number | null) => void;
  onUpdateDay: (clientId: string, patch: (d: DraftDay) => DraftDay) => void;
  onRemoveDay: (clientId: string) => void;
  onMoveDay: (clientId: string, direction: 'up' | 'down') => void;
  onOpenPicker: (clientId: string) => void;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const atCap = days.length >= MAX_ROUTINE_DAYS;

  const takenWeekdays = new Set(
    days.filter((d) => d.weekday !== null).map((d) => d.weekday as number),
  );

  // Templates already in the routine — filter out so the same one isn't
  // double-added (matches settings editor behavior).
  const usedTemplateIds = new Set(
    days
      .filter((d): d is DraftDayExisting => d.kind === 'existing' && d.templateId !== null)
      .map((d) => d.templateId as string),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base text-ink-100">Build your days</h2>
          <p className="text-[11px] text-ink-500 italic font-display mt-0.5">
            {scheduleStyle === 'weekday'
              ? 'Pick a weekday to add a day, then choose what goes on it.'
              : 'Add days in the order you want to cycle them.'}
          </p>
        </div>
        <span className="text-[11px] text-ink-500 font-mono">
          {days.length} / {MAX_ROUTINE_DAYS}
        </span>
      </div>

      {scheduleStyle === 'weekday' ? (
        <WeekdayAdder
          takenWeekdays={takenWeekdays}
          atCap={atCap}
          onPickWeekday={(wd) => onAddDay(wd)}
        />
      ) : (
        !atCap && (
          <button
            onClick={() => onAddDay(null)}
            className="w-full border border-dashed border-ink-700 rounded-lg py-3 text-sm text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Add a day
          </button>
        )
      )}

      <div className="space-y-3">
        {days.map((day, idx) => (
          <DayCard
            key={day.clientId}
            day={day}
            index={idx}
            scheduleStyle={scheduleStyle}
            templates={templates}
            usedTemplateIds={usedTemplateIds}
            takenWeekdays={takenWeekdays}
            exerciseById={exerciseById}
            templatesById={templatesById}
            canMoveUp={idx > 0}
            canMoveDown={idx < days.length - 1}
            onUpdate={(patch) => onUpdateDay(day.clientId, patch)}
            onRemove={() => onRemoveDay(day.clientId)}
            onMove={(dir) => onMoveDay(day.clientId, dir)}
            onOpenPicker={() => onOpenPicker(day.clientId)}
          />
        ))}
      </div>

      {atCap && (
        <p className="text-[11px] text-ink-500 italic font-display">
          Routine cap is {MAX_ROUTINE_DAYS} days.
        </p>
      )}

      {days.length > 0 && (
        <CoveragePanel coverage={coverage} scheduleStyle={scheduleStyle} compact />
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 text-xs tracking-wider uppercase text-ink-300 hover:text-ink-100 transition inline-flex items-center gap-2"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!canAdvance}
          className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          Review <ArrowRight size={14} />
        </button>
      </div>

    </div>
  );
}

function WeekdayAdder({
  takenWeekdays,
  atCap,
  onPickWeekday,
}: {
  takenWeekdays: Set<number>;
  atCap: boolean;
  onPickWeekday: (wd: number) => void;
}) {
  return (
    <div className="border border-dashed border-ink-700 rounded-lg p-3">
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400 mb-2">
        Add a day
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {WEEKDAY_LABELS.map((wd, i) => {
          const taken = takenWeekdays.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => !taken && !atCap && onPickWeekday(i)}
              disabled={taken || atCap}
              aria-label={WEEKDAY_FULL_LABELS[i]}
              className={`text-xs font-mono px-3 py-1.5 rounded border transition ${
                taken
                  ? 'bg-ink-900/60 text-ink-700 border-ink-900 cursor-not-allowed'
                  : atCap
                    ? 'border-ink-800 text-ink-700 cursor-not-allowed'
                    : 'border-ink-700 text-ink-300 hover:border-accent/50 hover:text-ink-100'
              }`}
            >
              {wd}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-ink-500 italic font-display mt-2">
        Skipped weekdays are rest days.
      </p>
    </div>
  );
}

// ============ DAY CARD ============

function DayCard({
  day,
  index,
  scheduleStyle,
  templates,
  usedTemplateIds,
  takenWeekdays,
  exerciseById,
  templatesById,
  canMoveUp,
  canMoveDown,
  onUpdate,
  onRemove,
  onMove,
  onOpenPicker,
}: {
  day: DraftDay;
  index: number;
  scheduleStyle: ScheduleStyle;
  templates: WizardTemplateOption[];
  usedTemplateIds: Set<string>;
  takenWeekdays: Set<number>;
  exerciseById: Map<string, ExerciseInfo>;
  templatesById: Map<string, WizardTemplateOption>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onUpdate: (patch: (d: DraftDay) => DraftDay) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onOpenPicker: () => void;
}) {
  const setKind = (kind: 'existing' | 'new') => {
    onUpdate((d) => {
      if (d.kind === kind) return d;
      // Switching kinds preserves shared fields; resets kind-specific state.
      const shared: DraftDayShared = {
        clientId: d.clientId,
        label: d.label,
        weekday: d.weekday,
      };
      if (kind === 'existing') {
        return { ...shared, kind: 'existing', templateId: null };
      }
      return {
        ...shared,
        kind: 'new',
        templateName: `Day ${index + 1}`,
        exercises: [],
      };
    });
  };

  const dayHeader =
    scheduleStyle === 'weekday' && day.weekday !== null
      ? WEEKDAY_FULL_LABELS[day.weekday]
      : `Day ${index + 1}`;

  return (
    <div className="border border-ink-800 rounded-lg overflow-hidden">
      {/* Header strip */}
      <div className="bg-ink-900/40 px-3 py-2 flex items-center justify-between border-b border-ink-900">
        <div className="flex items-center gap-2">
          {scheduleStyle === 'sequence' && (
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => onMove('up')}
                disabled={!canMoveUp}
                className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label="Move day up"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => onMove('down')}
                disabled={!canMoveDown}
                className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label="Move day down"
              >
                <ChevronDown size={12} />
              </button>
            </div>
          )}
          <span className="text-sm text-ink-100">{dayHeader}</span>
          <input
            type="text"
            value={day.label}
            onChange={(e) => onUpdate((d) => ({ ...d, label: e.target.value }))}
            placeholder="optional label"
            className="bg-ink-950 border border-ink-800 rounded px-2 py-1 text-[11px] text-ink-200 focus:outline-none focus:border-accent/50 w-32"
          />
        </div>
        <button
          onClick={onRemove}
          className="text-ink-500 hover:text-bad transition"
          aria-label="Remove day"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {scheduleStyle === 'weekday' && (
          <WeekdayPicker
            value={day.weekday}
            takenWeekdays={takenWeekdays}
            onChange={(wd) => onUpdate((d) => ({ ...d, weekday: wd }))}
          />
        )}

        {/* Mode tabs */}
        <div className="flex gap-1 text-[11px]">
          <ModeTab
            active={day.kind === 'existing'}
            onClick={() => setKind('existing')}
            label="Pick existing"
          />
          <ModeTab
            active={day.kind === 'new'}
            onClick={() => setKind('new')}
            label="Build new"
          />
        </div>

        {day.kind === 'existing' ? (
          <ExistingTemplatePicker
            day={day}
            templates={templates}
            usedTemplateIds={usedTemplateIds}
            templatesById={templatesById}
            onUpdate={onUpdate}
          />
        ) : (
          <NewTemplateBuilder
            day={day}
            exerciseById={exerciseById}
            onUpdate={onUpdate}
            onOpenPicker={onOpenPicker}
          />
        )}
      </div>
    </div>
  );
}

function WeekdayPicker({
  value,
  takenWeekdays,
  onChange,
}: {
  value: number | null;
  takenWeekdays: Set<number>;
  onChange: (wd: number | null) => void;
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
              disabled={taken}
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

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded border transition ${
        active
          ? 'border-accent text-ink-100 bg-accent/5'
          : 'border-ink-800 text-ink-400 hover:border-ink-600 hover:text-ink-200'
      }`}
    >
      {label}
    </button>
  );
}

function ExistingTemplatePicker({
  day,
  templates,
  usedTemplateIds,
  templatesById,
  onUpdate,
}: {
  day: DraftDayExisting;
  templates: WizardTemplateOption[];
  usedTemplateIds: Set<string>;
  templatesById: Map<string, WizardTemplateOption>;
  onUpdate: (patch: (d: DraftDay) => DraftDay) => void;
}) {
  // Templates this day could pick: not used elsewhere, OR the one this day
  // currently points at (so the user can see their own choice as selected).
  const options = templates.filter(
    (t) => !usedTemplateIds.has(t.id) || t.id === day.templateId,
  );

  if (options.length === 0) {
    return (
      <p className="text-[11px] text-ink-500 italic font-display">
        Every template is already in your routine. Switch to &ldquo;Build new&rdquo;
        to author another one.
      </p>
    );
  }

  const selected = day.templateId ? templatesById.get(day.templateId) : null;

  return (
    <div className="space-y-2">
      <select
        value={day.templateId ?? ''}
        onChange={(e) =>
          onUpdate((d) =>
            d.kind === 'existing' ? { ...d, templateId: e.target.value || null } : d,
          )
        }
        className="w-full bg-ink-900 border border-ink-800 rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-accent/50"
      >
        <option value="">— pick a template —</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.exercises.length}){t.isBuiltin ? ' · default' : ''}
          </option>
        ))}
      </select>
      {selected && (
        <p className="text-[11px] text-ink-500 leading-relaxed">
          {selected.exercises
            .slice(0, 6)
            .map((e) => e.name)
            .join(', ')}
          {selected.exercises.length > 6 ? '…' : ''}
        </p>
      )}
    </div>
  );
}

function NewTemplateBuilder({
  day,
  exerciseById,
  onUpdate,
  onOpenPicker,
}: {
  day: DraftDayNew;
  exerciseById: Map<string, ExerciseInfo>;
  onUpdate: (patch: (d: DraftDay) => DraftDay) => void;
  onOpenPicker: () => void;
}) {
  function setSets(exerciseId: string, sets: number) {
    onUpdate((d) =>
      d.kind === 'new'
        ? {
            ...d,
            exercises: d.exercises.map((e) =>
              e.exerciseId === exerciseId ? { ...e, plannedSets: sets } : e,
            ),
          }
        : d,
    );
  }

  function removeExercise(exerciseId: string) {
    onUpdate((d) =>
      d.kind === 'new'
        ? { ...d, exercises: d.exercises.filter((e) => e.exerciseId !== exerciseId) }
        : d,
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-500 block mb-1.5">
          Template name
        </label>
        <input
          type="text"
          value={day.templateName}
          onChange={(e) =>
            onUpdate((d) =>
              d.kind === 'new' ? { ...d, templateName: e.target.value } : d,
            )
          }
          placeholder="e.g. Lower body day"
          className="w-full bg-ink-900 border border-ink-800 rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-accent/50"
        />
        <p className="text-[10px] text-ink-600 italic font-display mt-1">
          Saved as a reusable template once you create the routine.
        </p>
      </div>

      {day.exercises.length > 0 && (
        <div className="space-y-1.5">
          {day.exercises.map((dei) => {
            const ex = exerciseById.get(dei.exerciseId);
            if (!ex) return null;
            return (
              <ExerciseInDayRow
                key={dei.exerciseId}
                exercise={ex}
                sets={dei.plannedSets}
                onSetsChange={(s) => setSets(dei.exerciseId, s)}
                onRemove={() => removeExercise(dei.exerciseId)}
              />
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenPicker}
        className="w-full border border-dashed border-ink-700 rounded-lg py-2 text-xs text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2"
      >
        <Plus size={12} />
        {day.exercises.length === 0 ? 'Pick exercises' : 'Add more exercises'}
      </button>
    </div>
  );
}

function ExerciseInDayRow({
  exercise,
  sets,
  onSetsChange,
  onRemove,
}: {
  exercise: ExerciseInfo;
  sets: number;
  onSetsChange: (sets: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-ink-900/40 border border-ink-900 rounded px-2.5 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-ink-100 truncate">{exercise.name}</div>
        <div className="text-[10px] text-ink-500 truncate">
          {exercise.primaryMuscles.join(', ')}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onSetsChange(Math.max(1, sets - 1))}
          disabled={sets <= 1}
          className="w-6 h-6 rounded border border-ink-800 text-ink-300 hover:border-accent/50 hover:text-ink-100 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
          aria-label="Decrease sets"
        >
          <Minus size={11} />
        </button>
        <span className="text-xs font-mono text-ink-200 w-8 text-center tabular-nums">
          {sets} <span className="text-ink-600">×</span>
        </span>
        <button
          type="button"
          onClick={() => onSetsChange(Math.min(20, sets + 1))}
          disabled={sets >= 20}
          className="w-6 h-6 rounded border border-ink-800 text-ink-300 hover:border-accent/50 hover:text-ink-100 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
          aria-label="Increase sets"
        >
          <Plus size={11} />
        </button>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-ink-500 hover:text-bad transition shrink-0"
        aria-label={`Remove ${exercise.name}`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ============ STEP 3 — REVIEW ============

function Step3Review({
  name,
  description,
  scheduleStyle,
  days,
  templatesById,
  exerciseById,
  coverage,
  isPending,
  submitError,
  onBack,
  onSubmit,
}: {
  name: string;
  description: string;
  scheduleStyle: ScheduleStyle;
  days: DraftDay[];
  templatesById: Map<string, WizardTemplateOption>;
  exerciseById: Map<string, ExerciseInfo>;
  coverage: CoverageStat[];
  isPending: boolean;
  submitError: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="border border-ink-800 rounded-lg p-4 space-y-3">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">Name</div>
          <div className="text-sm text-ink-100 mt-0.5">{name.trim()}</div>
        </div>
        {description.trim() && (
          <div>
            <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
              Description
            </div>
            <div className="text-sm text-ink-300 mt-0.5">{description.trim()}</div>
          </div>
        )}
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">Cycle</div>
          <div className="text-sm text-ink-100 mt-0.5">
            {scheduleStyle === 'weekday'
              ? 'Calendar — pinned to weekdays'
              : 'Cycle — self-paced rotation'}
          </div>
        </div>
      </div>

      <div className="border border-ink-800 rounded-lg p-4">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
          Days ({days.length})
        </div>
        <div className="space-y-2">
          {days.map((day, idx) => (
            <ReviewDayRow
              key={day.clientId}
              day={day}
              index={idx}
              scheduleStyle={scheduleStyle}
              templatesById={templatesById}
              exerciseById={exerciseById}
            />
          ))}
        </div>
      </div>

      <CoveragePanel coverage={coverage} scheduleStyle={scheduleStyle} compact={false} />

      {submitError && (
        <p className="text-[12px] text-bad border border-bad/30 rounded px-3 py-2">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={onBack}
          disabled={isPending}
          className="px-4 py-2 text-xs tracking-wider uppercase text-ink-300 hover:text-ink-100 transition inline-flex items-center gap-2 disabled:opacity-50"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <button
          onClick={onSubmit}
          disabled={isPending}
          className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          <Check size={14} strokeWidth={3} /> {isPending ? 'Creating…' : 'Create routine'}
        </button>
      </div>
    </div>
  );
}

function ReviewDayRow({
  day,
  index,
  scheduleStyle,
  templatesById,
  exerciseById,
}: {
  day: DraftDay;
  index: number;
  scheduleStyle: ScheduleStyle;
  templatesById: Map<string, WizardTemplateOption>;
  exerciseById: Map<string, ExerciseInfo>;
}) {
  const dayLabel =
    scheduleStyle === 'weekday' && day.weekday !== null
      ? WEEKDAY_FULL_LABELS[day.weekday]
      : `Day ${index + 1}`;

  let bodyName: string;
  let exerciseNames: string[] = [];

  if (day.kind === 'existing') {
    const tpl = day.templateId ? templatesById.get(day.templateId) : null;
    bodyName = tpl ? tpl.name : '(none picked)';
    exerciseNames = tpl ? tpl.exercises.map((e) => e.name) : [];
  } else {
    bodyName = `${day.templateName.trim() || 'Untitled'} (new)`;
    exerciseNames = day.exercises
      .map((dei) => exerciseById.get(dei.exerciseId)?.name)
      .filter((n): n is string => !!n);
  }

  return (
    <div className="bg-ink-900/30 rounded px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-ink-100">
          <span className="font-mono text-[11px] text-ink-500 mr-1.5">{dayLabel}</span>
          <span>{bodyName}</span>
          {day.label.trim() && (
            <span className="text-[11px] text-ink-500 italic font-display ml-2">
              · {day.label.trim()}
            </span>
          )}
        </div>
        <span className="text-[11px] text-ink-500 font-mono">
          {exerciseNames.length} ex
        </span>
      </div>
      {exerciseNames.length > 0 && (
        <div className="text-[11px] text-ink-500 mt-1 leading-relaxed">
          {exerciseNames.slice(0, 6).join(', ')}
          {exerciseNames.length > 6 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

// ============ COVERAGE PANEL ============

function CoveragePanel({
  coverage,
  scheduleStyle,
  compact,
}: {
  coverage: CoverageStat[];
  scheduleStyle: ScheduleStyle;
  compact: boolean;
}) {
  // Hypertrophy targets only meaningful for muscles with weekly targets and
  // some setup. Coverage rows are organized: gaps first, then met, then
  // unworked-with-target, then mobility/other.
  const withTarget = coverage.filter((c) => c.target !== null);
  const withoutTarget = coverage.filter((c) => c.target === null);

  // Group the targeted muscles by status for prominence ordering.
  const under: CoverageStat[] = [];
  const met: CoverageStat[] = [];
  const unworked: CoverageStat[] = [];
  for (const c of withTarget) {
    if (c.unworked) unworked.push(c);
    else if (scheduleStyle === 'weekday' && c.weekdayGap === 'under') under.push(c);
    else met.push(c);
  }

  // Mobility / soft tissue / cardio: show only those touched. Untouched
  // mobility muscles aren't a meaningful "gap" — they're optional.
  const mobilityTouched = withoutTarget.filter((c) => !c.unworked);

  return (
    <div className="border border-ink-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400">
            Coverage estimate
          </div>
          <p className="text-[11px] text-ink-500 italic font-display mt-0.5 leading-relaxed">
            {scheduleStyle === 'weekday'
              ? 'Weekly volume vs. your targets, assuming 3 sets per existing-template exercise.'
              : 'Total per cycle — weekly volume depends on how often you complete the cycle.'}
          </p>
        </div>
      </div>

      {unworked.length > 0 && (
        <CoverageGroup
          title="Not worked"
          tone="under"
          items={unworked}
          scheduleStyle={scheduleStyle}
        />
      )}
      {under.length > 0 && (
        <CoverageGroup
          title="Below target"
          tone="under"
          items={under}
          scheduleStyle={scheduleStyle}
        />
      )}
      {met.length > 0 && (
        <CoverageGroup
          title="Covered"
          tone="met"
          items={met}
          scheduleStyle={scheduleStyle}
          collapsible={compact}
        />
      )}
      {mobilityTouched.length > 0 && (
        <CoverageGroup
          title="Mobility & other"
          tone="neutral"
          items={mobilityTouched}
          scheduleStyle={scheduleStyle}
          collapsible={compact}
        />
      )}
    </div>
  );
}

function CoverageGroup({
  title,
  tone,
  items,
  scheduleStyle,
  collapsible = false,
}: {
  title: string;
  tone: 'under' | 'met' | 'neutral';
  items: CoverageStat[];
  scheduleStyle: ScheduleStyle;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const toneRing =
    tone === 'under'
      ? 'border-l-bad/60'
      : tone === 'met'
        ? 'border-l-good/60'
        : 'border-l-ink-700';

  return (
    <div className={`border-l-2 ${toneRing} pl-3 mt-3 first:mt-2`}>
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        disabled={!collapsible}
        className="text-[10px] tracking-[0.25em] uppercase text-ink-400 mb-1.5 flex items-center gap-1.5"
      >
        {title}
        <span className="text-ink-600 font-mono normal-case tracking-normal">
          ({items.length})
        </span>
        {collapsible && (
          <span className="text-ink-600">{open ? '−' : '+'}</span>
        )}
      </button>
      {open && (
        <div className="space-y-1">
          {items.map((c) => (
            <CoverageRow key={c.muscleId} stat={c} scheduleStyle={scheduleStyle} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoverageRow({
  stat,
  scheduleStyle,
}: {
  stat: CoverageStat;
  scheduleStyle: ScheduleStyle;
}) {
  const display =
    scheduleStyle === 'weekday'
      ? formatVolume(stat.setsPerWeek ?? 0)
      : formatVolume(stat.setsPerCycle);

  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-ink-200 truncate">{stat.label}</span>
      <span className="font-mono text-ink-400 shrink-0 tabular-nums">
        {display}
        {stat.target !== null && scheduleStyle === 'weekday' && (
          <span className="text-ink-600">/{stat.target}/wk</span>
        )}
        {stat.target !== null && scheduleStyle === 'sequence' && (
          <span className="text-ink-600">·target {stat.target}/wk</span>
        )}
        {stat.target === null && <span className="text-ink-600"> per cycle</span>}
      </span>
    </div>
  );
}

function formatVolume(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
