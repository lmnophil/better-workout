'use client';

// Settings UI for the user's routine. One routine per user, with a list of
// days that each point at an existing template. Two scheduling modes
// (sequence | weekday) — see lib/routine.ts.

import { useState, useTransition } from 'react';
import { ChevronUp, ChevronDown, Trash2, Plus, X } from 'lucide-react';
import {
  createRoutine,
  updateRoutine,
  deleteRoutine,
  addRoutineDay,
  updateRoutineDay,
  removeRoutineDay,
  reorderRoutineDay,
} from '@/lib/actions';
import {
  MAX_ROUTINE_DAYS,
  WEEKDAY_LABELS,
  WEEKDAY_FULL_LABELS,
  type ScheduleStyle,
} from '@/lib/routine';
import { useConfirm } from '@/components/ui/use-confirm';

export type RoutineDayClient = {
  id: string;
  position: number;
  weekday: number | null;
  label: string | null;
  templateId: string;
  templateName: string;
  exerciseCount: number;
};

export type RoutineClient = {
  id: string;
  name: string;
  description: string | null;
  scheduleStyle: ScheduleStyle;
  lastCompletedPosition: number | null;
  days: RoutineDayClient[];
};

export type TemplateOptionClient = {
  id: string;
  name: string;
  isBuiltin: boolean;
  exerciseCount: number;
};

type Props = {
  routine: RoutineClient | null;
  templates: TemplateOptionClient[];
};

export function RoutineEditor({ routine, templates }: Props) {
  const [isPending, startTransition] = useTransition();
  const { confirm, Dialog: ConfirmDialog } = useConfirm();

  if (!routine) {
    return (
      <>
        <CreateRoutinePanel isPending={isPending} startTransition={startTransition} />
        {ConfirmDialog}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <RoutineMetaPanel routine={routine} startTransition={startTransition} isPending={isPending} />
      <DaysPanel
        routine={routine}
        templates={templates}
        startTransition={startTransition}
        isPending={isPending}
        confirm={confirm}
      />
      <DangerZonePanel
        routineName={routine.name}
        startTransition={startTransition}
        isPending={isPending}
        confirm={confirm}
      />
      {ConfirmDialog}
    </div>
  );
}

// ============ CREATE ROUTINE ============

function CreateRoutinePanel({
  isPending,
  startTransition,
}: {
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleStyle, setScheduleStyle] = useState<ScheduleStyle>('sequence');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await createRoutine({
          name: trimmedName,
          description: description.trim() || undefined,
          scheduleStyle,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create routine.');
      }
    });
  }

  return (
    <div className="border border-ink-800 rounded-lg p-4 space-y-4">
      <div>
        <p className="text-xs text-ink-400 italic font-display leading-relaxed">
          A routine is your cycle of templates — your way of saying &quot;last time I
          did A, this time B, then C, then loop.&quot; The app reflects what you
          told it; it doesn&apos;t prescribe.
        </p>
      </div>

      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Edwardo's program"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
        />
      </div>

      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Description <span className="text-ink-600">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this for?"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
        />
      </div>

      <ScheduleStylePicker value={scheduleStyle} onChange={setScheduleStyle} />

      {error && <p className="text-[11px] text-bad">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={name.trim().length === 0 || isPending}
          className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Create routine
        </button>
      </div>
    </div>
  );
}

// ============ ROUTINE META ============

function RoutineMetaPanel({
  routine,
  startTransition,
  isPending,
}: {
  routine: RoutineClient;
  startTransition: React.TransitionStartFunction;
  isPending: boolean;
}) {
  const [name, setName] = useState(routine.name);
  const [description, setDescription] = useState(routine.description ?? '');
  const [scheduleStyle, setScheduleStyle] = useState<ScheduleStyle>(routine.scheduleStyle);
  const [error, setError] = useState<string | null>(null);

  // Track dirty state — only show "save" when there's a change.
  const dirty =
    name.trim() !== routine.name ||
    (description.trim() || null) !== routine.description ||
    scheduleStyle !== routine.scheduleStyle;

  function submit() {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateRoutine({
          name: trimmedName,
          description: description.trim() || null,
          scheduleStyle,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save changes.');
      }
    });
  }

  const switchingStyle = scheduleStyle !== routine.scheduleStyle;

  return (
    <div className="border border-ink-800 rounded-lg p-4 space-y-4">
      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
        />
      </div>

      <div>
        <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
          Description <span className="text-ink-600">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this for?"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
        />
      </div>

      <ScheduleStylePicker value={scheduleStyle} onChange={setScheduleStyle} />
      {switchingStyle && (
        <p className="text-[11px] text-ink-500 italic font-display">
          Switching the schedule style clears any weekday assignments and
          resets the cycle position to the start.
        </p>
      )}

      {error && <p className="text-[11px] text-bad">{error}</p>}

      {dirty && (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setName(routine.name);
              setDescription(routine.description ?? '');
              setScheduleStyle(routine.scheduleStyle);
              setError(null);
            }}
            disabled={isPending}
            className="px-4 py-2 text-xs tracking-wider uppercase text-ink-300 hover:text-ink-100 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={name.trim().length === 0 || isPending}
            className="accent-bg text-ink-950 px-4 py-2 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

function ScheduleStylePicker({
  value,
  onChange,
}: {
  value: ScheduleStyle;
  onChange: (s: ScheduleStyle) => void;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-400 mb-1.5">
        Schedule style
      </div>
      <div className="space-y-1.5">
        <StyleOption
          active={value === 'sequence'}
          onClick={() => onChange('sequence')}
          title="Cycle"
          description="Self-paced rotation. After each completed routine workout, the next day in your cycle becomes today."
        />
        <StyleOption
          active={value === 'weekday'}
          onClick={() => onChange('weekday')}
          title="Calendar"
          description="Pin each day to a specific weekday. Skipping a day in real life means skipping it; rest days are weekdays you don't pin."
        />
      </div>
    </div>
  );
}

function StyleOption({
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
        active
          ? 'border-accent bg-accent/5'
          : 'border-ink-800 hover:border-ink-600'
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

// ============ DAYS LIST ============

type ConfirmFn = ReturnType<typeof useConfirm>['confirm'];

function DaysPanel({
  routine,
  templates,
  startTransition,
  isPending,
  confirm,
}: {
  routine: RoutineClient;
  templates: TemplateOptionClient[];
  startTransition: React.TransitionStartFunction;
  isPending: boolean;
  confirm: ConfirmFn;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const atCap = routine.days.length >= MAX_ROUTINE_DAYS;
  // Templates not yet referenced by any routine day — the picker filters
  // these out so the same template isn't double-added (stays valid for
  // permanent edits, just keeps the routine concise).
  const usedTemplateIds = new Set(routine.days.map((d) => d.templateId));
  const availableTemplates = templates.filter((t) => !usedTemplateIds.has(t.id));

  return (
    <div className="border border-ink-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm text-ink-100">Days</h3>
        <span className="text-[11px] text-ink-500">
          {routine.days.length} / {MAX_ROUTINE_DAYS}
        </span>
      </div>

      {routine.days.length === 0 && (
        <p className="text-[11px] text-ink-500 italic font-display mb-3">
          No days yet. Add a template below to start your routine.
        </p>
      )}

      <div className="space-y-1.5">
        {routine.days.map((day, idx) => (
          <DayRow
            key={day.id}
            day={day}
            scheduleStyle={routine.scheduleStyle}
            takenWeekdays={
              new Set(
                routine.days
                  .filter((d) => d.id !== day.id && d.weekday !== null)
                  .map((d) => d.weekday as number),
              )
            }
            templates={templates}
            canMoveUp={idx > 0}
            canMoveDown={idx < routine.days.length - 1}
            startTransition={startTransition}
            isPending={isPending}
            confirm={confirm}
          />
        ))}
      </div>

      {!addOpen && !atCap && availableTemplates.length > 0 && (
        <button
          onClick={() => setAddOpen(true)}
          className="mt-3 w-full border border-dashed border-ink-700 rounded-lg py-2.5 text-xs text-ink-300 hover:border-accent/50 hover:text-ink-100 transition flex items-center justify-center gap-2"
        >
          <Plus size={13} />
          Add a day
        </button>
      )}
      {addOpen && (
        <AddDayForm
          templates={availableTemplates}
          scheduleStyle={routine.scheduleStyle}
          takenWeekdays={
            new Set(
              routine.days
                .filter((d) => d.weekday !== null)
                .map((d) => d.weekday as number),
            )
          }
          onClose={() => setAddOpen(false)}
          startTransition={startTransition}
          isPending={isPending}
        />
      )}
      {atCap && (
        <p className="text-[11px] text-ink-500 italic font-display mt-3">
          Routine cap is {MAX_ROUTINE_DAYS} days. Remove one to add another.
        </p>
      )}
      {!atCap && availableTemplates.length === 0 && routine.days.length > 0 && (
        <p className="text-[11px] text-ink-500 italic font-display mt-3">
          Every template is already in your routine. Create a new template
          from the workout page to add more variety.
        </p>
      )}
    </div>
  );
}

function DayRow({
  day,
  scheduleStyle,
  takenWeekdays,
  templates,
  canMoveUp,
  canMoveDown,
  startTransition,
  isPending,
  confirm,
}: {
  day: RoutineDayClient;
  scheduleStyle: ScheduleStyle;
  takenWeekdays: Set<number>;
  templates: TemplateOptionClient[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  startTransition: React.TransitionStartFunction;
  isPending: boolean;
  confirm: ConfirmFn;
}) {
  const [labelEditing, setLabelEditing] = useState(false);
  const [label, setLabel] = useState(day.label ?? '');
  const [error, setError] = useState<string | null>(null);

  function commitLabel() {
    const trimmed = label.trim();
    if ((trimmed || null) === day.label) {
      setLabelEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateRoutineDay({ routineDayId: day.id, label: trimmed || null });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save label.');
      }
    });
    setLabelEditing(false);
  }

  function pickWeekday(wd: number | null) {
    setError(null);
    startTransition(async () => {
      try {
        await updateRoutineDay({ routineDayId: day.id, weekday: wd });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not assign weekday.');
      }
    });
  }

  function changeTemplate(templateId: string) {
    if (templateId === day.templateId) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateRoutineDay({ routineDayId: day.id, templateId });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not change template.');
      }
    });
  }

  async function handleRemove() {
    if (
      !(await confirm({
        title: 'Remove this day from your routine?',
        message:
          'The template stays — only this day is dropped. Sessions you already completed from this day stay in your history.',
        confirmLabel: 'Remove',
        variant: 'danger',
      }))
    )
      return;
    startTransition(async () => {
      try {
        await removeRoutineDay({ routineDayId: day.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not remove day.');
      }
    });
  }

  function handleMove(direction: 'up' | 'down') {
    startTransition(() => {
      reorderRoutineDay({ routineDayId: day.id, direction });
    });
  }

  return (
    <div className="bg-ink-900/40 rounded-lg px-3 py-2.5 border border-ink-900">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1 pt-0.5">
          <button
            onClick={() => handleMove('up')}
            disabled={!canMoveUp || isPending}
            className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            aria-label="Move day up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => handleMove('down')}
            disabled={!canMoveDown || isPending}
            className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
            aria-label="Move day down"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={day.templateId}
              onChange={(e) => changeTemplate(e.target.value)}
              disabled={isPending}
              className="bg-ink-900 border border-ink-800 rounded px-2 py-1 text-sm text-ink-100 focus:outline-none focus:border-accent/50 disabled:opacity-60"
            >
              {/* Always include the current template even if filtered out of "available" elsewhere */}
              <option value={day.templateId}>
                {day.templateName} ({day.exerciseCount})
              </option>
              {templates
                .filter((t) => t.id !== day.templateId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.exerciseCount}){t.isBuiltin ? ' · default' : ''}
                  </option>
                ))}
            </select>

            {labelEditing ? (
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    setLabel(day.label ?? '');
                    setLabelEditing(false);
                  }
                }}
                placeholder="optional label"
                autoFocus
                className="bg-ink-900 border border-ink-800 rounded px-2 py-1 text-xs text-ink-100 focus:outline-none focus:border-accent/50 w-32"
              />
            ) : (
              <button
                onClick={() => setLabelEditing(true)}
                className="text-[11px] text-ink-500 hover:text-ink-300 transition italic font-display"
              >
                {day.label ? day.label : '+ add label'}
              </button>
            )}
          </div>

          {scheduleStyle === 'weekday' && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {WEEKDAY_LABELS.map((wd, i) => {
                const isMine = day.weekday === i;
                const taken = takenWeekdays.has(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickWeekday(isMine ? null : i)}
                    disabled={isPending || (taken && !isMine)}
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
              {day.weekday === null && (
                <span className="text-[10px] text-ink-500 italic font-display">
                  not pinned yet
                </span>
              )}
            </div>
          )}

          {error && <p className="text-[11px] text-bad mt-1">{error}</p>}
        </div>

        <button
          onClick={handleRemove}
          disabled={isPending}
          className="text-ink-500 hover:text-bad transition disabled:opacity-50"
          aria-label="Remove day"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function AddDayForm({
  templates,
  scheduleStyle,
  takenWeekdays,
  onClose,
  startTransition,
  isPending,
}: {
  templates: TemplateOptionClient[];
  scheduleStyle: ScheduleStyle;
  takenWeekdays: Set<number>;
  onClose: () => void;
  startTransition: React.TransitionStartFunction;
  isPending: boolean;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [weekday, setWeekday] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!templateId) return;
    setError(null);
    startTransition(async () => {
      try {
        await addRoutineDay({
          templateId,
          label: label.trim() || undefined,
          weekday: scheduleStyle === 'weekday' ? weekday : undefined,
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add day.');
      }
    });
  }

  return (
    <div className="mt-3 border border-ink-800 rounded-lg p-3 space-y-3 bg-ink-900/30">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.25em] uppercase text-ink-400">
          New day
        </span>
        <button
          onClick={onClose}
          className="text-ink-500 hover:text-ink-100 transition"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div>
        <label className="text-[10px] tracking-[0.2em] uppercase text-ink-500 block mb-1">
          Template
        </label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full bg-ink-900 border border-ink-800 rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-accent/50"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.exerciseCount}){t.isBuiltin ? ' · default' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[10px] tracking-[0.2em] uppercase text-ink-500 block mb-1">
          Label <span className="text-ink-600">(optional)</span>
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Heavy day"
          className="w-full bg-ink-900 border border-ink-800 rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-accent/50"
        />
      </div>

      {scheduleStyle === 'weekday' && (
        <div>
          <label className="text-[10px] tracking-[0.2em] uppercase text-ink-500 block mb-1">
            Weekday <span className="text-ink-600">(optional)</span>
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAY_LABELS.map((wd, i) => {
              const isMine = weekday === i;
              const taken = takenWeekdays.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setWeekday(isMine ? null : i)}
                  disabled={taken && !isMine}
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
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-bad">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={isPending}
          className="px-3 py-1.5 text-xs tracking-wider uppercase text-ink-300 hover:text-ink-100 transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!templateId || isPending}
          className="accent-bg text-ink-950 px-3 py-1.5 rounded text-xs font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Add day
        </button>
      </div>
    </div>
  );
}

// ============ DANGER ZONE ============

function DangerZonePanel({
  routineName,
  startTransition,
  isPending,
  confirm,
}: {
  routineName: string;
  startTransition: React.TransitionStartFunction;
  isPending: boolean;
  confirm: ConfirmFn;
}) {
  async function handleDelete() {
    if (
      !(await confirm({
        title: `Delete "${routineName}"?`,
        message:
          'This deletes the routine itself. Your templates and history stay. You can build a new routine afterward.',
        confirmLabel: 'Delete routine',
        variant: 'danger',
      }))
    )
      return;
    startTransition(() => {
      deleteRoutine();
    });
  }

  return (
    <div className="border border-ink-900 rounded-lg p-4 flex items-center justify-between gap-3">
      <div>
        <div className="text-sm text-ink-100">Delete this routine</div>
        <div className="text-[11px] text-ink-500 italic font-display mt-0.5">
          Templates and session history are unaffected.
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
