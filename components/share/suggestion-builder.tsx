'use client';

// Hosts the various reviewer-side suggestion flows in one modal. The parent
// (ShareView) drives state into this component via the `state` discriminator;
// this component picks the right inner flow and dispatches the resulting
// suggestion through `postShareSuggestion`.

import { useState, useTransition } from 'react';
import { postShareSuggestion } from '@/lib/actions';
import { ReviewerPicker, type LibraryExercise } from './reviewer-picker';
import type { RoutineForShare } from './share-view';
import { X } from 'lucide-react';

type SwapState = {
  kind: 'swap';
  dayId: string;
  outExerciseId: string;
  outName: string;
};
type InsertState = {
  kind: 'insert';
  dayId: string;
  atPosition: number;
};
type CustomState = {
  kind: 'custom';
  dayId: string | null;
};
type ReorderState = {
  kind: 'reorder';
  dayId: string;
};
type HolisticState = { kind: 'holistic_add' } | { kind: 'holistic_remove' };

type BuilderState = SwapState | InsertState | CustomState | ReorderState | HolisticState;

type Props = {
  token: string;
  state: BuilderState;
  routine: RoutineForShare;
  library: LibraryExercise[];
  libraryById: Map<string, LibraryExercise>;
  onClose: () => void;
};

export function SuggestionBuilder({ token, state, routine, library, libraryById, onClose }: Props) {
  switch (state.kind) {
    case 'swap':
      return (
        <SwapFlow
          token={token}
          state={state}
          library={library}
          libraryById={libraryById}
          routine={routine}
          onClose={onClose}
        />
      );
    case 'insert':
      return <InsertFlow token={token} state={state} library={library} onClose={onClose} />;
    case 'custom':
      return <CustomFlow token={token} state={state} onClose={onClose} />;
    case 'reorder':
      return <ReorderFlow token={token} state={state} routine={routine} onClose={onClose} />;
    case 'holistic_add':
    case 'holistic_remove':
      return (
        <HolisticFlow
          token={token}
          kind={state.kind}
          library={library}
          routine={routine}
          onClose={onClose}
        />
      );
  }
}

// ---------------- Swap ----------------
// The reviewer can swap an exercise for (a) a specific other exercise,
// (b) any of several candidates (multi-pick), or (c) "any exercise in this
// muscle/category" — the owner picks. All three are surfaced as one flow so
// the reviewer can step up granularity as they see fit.

function SwapFlow({
  token,
  state,
  library,
  libraryById,
  routine: _routine,
  onClose,
}: {
  token: string;
  state: SwapState;
  library: LibraryExercise[];
  libraryById: Map<string, LibraryExercise>;
  routine: RoutineForShare;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'specific' | 'anyof' | 'category'>('specific');
  const [pending, startTransition] = useTransition();
  const out = libraryById.get(state.outExerciseId);

  const dispatch = (payload: Record<string, unknown>) => {
    startTransition(async () => {
      try {
        // Close only on success — an expected failure (revoked share, expired
        // reviewer cookie) resolves { ok: false } and the composed suggestion
        // shouldn't silently vanish with the modal.
        const res = await postShareSuggestion({
          token,
          targetType: 'routine_day',
          targetId: state.dayId,
          // The action's Zod schema validates the union; cast keeps TS calm.
          payload: payload as never,
        });
        if (res.ok) onClose();
      } catch {
        /* silent */
      }
    });
  };

  return (
    <ModalShell title={`Swap ${state.outName}`} onClose={onClose}>
      <Tabs
        value={mode}
        onChange={setMode}
        options={[
          { value: 'specific', label: 'one exercise' },
          { value: 'anyof', label: 'any of these' },
          { value: 'category', label: 'any in a category' },
        ]}
      />
      {mode === 'specific' && (
        <ReviewerPicker
          library={library}
          mode="single"
          excludeIds={new Set([state.outExerciseId])}
          primaryMuscleHint={out?.primaryMuscles[0]}
          title="Pick a replacement"
          onCancel={onClose}
          onPick={(id) =>
            dispatch({
              kind: 'swap_specific',
              outExerciseId: state.outExerciseId,
              inExerciseId: id,
            })
          }
        />
      )}
      {mode === 'anyof' && (
        <ReviewerPicker
          library={library}
          mode="multi"
          excludeIds={new Set([state.outExerciseId])}
          primaryMuscleHint={out?.primaryMuscles[0]}
          title="Pick any that would work"
          onCancel={onClose}
          onPickMany={(ids) =>
            dispatch({
              kind: 'swap_anyof',
              outExerciseId: state.outExerciseId,
              candidateIds: ids,
            })
          }
        />
      )}
      {mode === 'category' && (
        <CategorySwapPicker
          out={out}
          onCancel={onClose}
          onSubmit={(filter) =>
            dispatch({
              kind: 'swap_category',
              outExerciseId: state.outExerciseId,
              ...filter,
            })
          }
          pending={pending}
        />
      )}
    </ModalShell>
  );
}

function CategorySwapPicker({
  out,
  onCancel,
  onSubmit,
  pending,
}: {
  out: LibraryExercise | undefined;
  onCancel: () => void;
  onSubmit: (filter: { primaryMuscle?: string; module?: string }) => void;
  pending: boolean;
}) {
  const [muscle, setMuscle] = useState(out?.primaryMuscles[0] ?? '');
  const [module, setModule] = useState(out?.module ?? '');

  return (
    <div className="px-4 py-4 space-y-3">
      <p className="text-sm text-ink-300">
        Suggest a swap to any exercise matching this filter. The owner will pick the actual
        replacement.
      </p>
      <label className="block">
        <span className="text-xs text-ink-400 block mb-1">Primary muscle</span>
        <input
          type="text"
          value={muscle}
          onChange={(e) => setMuscle(e.target.value)}
          placeholder="e.g. quads"
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100"
        />
      </label>
      <label className="block">
        <span className="text-xs text-ink-400 block mb-1">Module</span>
        <input
          type="text"
          value={module}
          onChange={(e) => setModule(e.target.value)}
          placeholder="e.g. Strength Accessory"
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100"
        >
          cancel
        </button>
        <button
          type="button"
          disabled={pending || (!muscle.trim() && !module.trim())}
          onClick={() =>
            onSubmit({
              primaryMuscle: muscle.trim() || undefined,
              module: module.trim() || undefined,
            })
          }
          className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
        >
          Send suggestion
        </button>
      </div>
    </div>
  );
}

// ---------------- Insert ----------------

function InsertFlow({
  token,
  state,
  library,
  onClose,
}: {
  token: string;
  state: InsertState;
  library: LibraryExercise[];
  onClose: () => void;
}) {
  return (
    <ReviewerPicker
      library={library}
      mode="multi"
      title={`Insert at position ${state.atPosition + 1}`}
      onCancel={onClose}
      onPickMany={async (ids) => {
        try {
          const res = await postShareSuggestion({
            token,
            targetType: 'routine_day',
            targetId: state.dayId,
            payload: {
              kind: 'insert',
              atPosition: state.atPosition,
              exerciseIds: ids,
            } as never,
          });
          if (res.ok) onClose();
        } catch {
          /* silent */
        }
      }}
    />
  );
}

// ---------------- Custom exercise ----------------

function CustomFlow({
  token,
  state,
  onClose,
}: {
  token: string;
  state: CustomState;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState('');
  const [module, setModule] = useState('');
  const [notes, setNotes] = useState('');
  const [metric, setMetric] = useState<'reps' | 'time'>('reps');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        const res = await postShareSuggestion({
          token,
          targetType: state.dayId ? 'routine_day' : 'routine',
          targetId: state.dayId, // null is OK for the routine target
          payload: {
            kind: 'custom_exercise',
            name: name.trim(),
            primaryMuscles: primary
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            secondaryMuscles: [],
            module: module.trim() || 'Custom',
            metric,
            notes: notes.trim() || undefined,
          } as never,
        });
        if (res.ok) onClose();
      } catch {
        /* silent */
      }
    });
  };

  return (
    <ModalShell title="Suggest a new exercise" onClose={onClose}>
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm text-ink-300">
          Propose an exercise the owner doesn’t have yet. If accepted, it’ll be added to their
          custom library
          {state.dayId ? ' and inserted into this day' : ''}.
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="exercise name"
          autoFocus
          maxLength={80}
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100"
        />
        <input
          type="text"
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          placeholder="primary muscles, comma separated"
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100"
        />
        <input
          type="text"
          value={module}
          onChange={(e) => setModule(e.target.value)}
          placeholder="module (e.g. Strength Accessory). Defaults to 'Custom'."
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100"
        />
        <div className="flex gap-2 text-xs">
          {(['reps', 'time'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={`px-2 py-1 rounded-md border ${
                metric === m
                  ? 'border-amber-400/60 bg-amber-400/10 text-ink-100'
                  : 'border-ink-700 text-ink-300'
              }`}
            >
              measured in {m}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="optional notes (form cues, equipment, etc.)"
          rows={3}
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100 resize-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100"
          >
            cancel
          </button>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={submit}
            className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
          >
            Send suggestion
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------- Reorder ----------------

function ReorderFlow({
  token,
  state,
  routine,
  onClose,
}: {
  token: string;
  state: ReorderState;
  routine: RoutineForShare;
  onClose: () => void;
}) {
  const day = routine.days.find((d) => d.id === state.dayId);
  const [order, setOrder] = useState<string[]>(
    () => day?.exercises.map((e) => e.templateExerciseId) ?? [],
  );
  const [pending, startTransition] = useTransition();

  if (!day) {
    onClose();
    return null;
  }

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    setOrder(next);
  };

  const exerciseById = new Map(day.exercises.map((e) => [e.templateExerciseId, e]));

  const submit = () => {
    startTransition(async () => {
      try {
        const res = await postShareSuggestion({
          token,
          targetType: 'routine_day',
          targetId: state.dayId,
          payload: {
            kind: 'reorder',
            orderedTemplateExerciseIds: order,
          } as never,
        });
        if (res.ok) onClose();
      } catch {
        /* silent */
      }
    });
  };

  return (
    <ModalShell title={`Reorder ${day.name}`} onClose={onClose}>
      <div className="px-4 py-4 space-y-2">
        <p className="text-sm text-ink-300">
          Use the arrows to reorder. The owner sees the proposed order and can one-click apply it.
        </p>
        <ol className="space-y-1">
          {order.map((id, idx) => {
            const ex = exerciseById.get(id);
            if (!ex) return null;
            return (
              <li
                key={id}
                className="flex items-center justify-between bg-ink-900 border border-ink-800 rounded-md px-2 py-1.5"
              >
                <span className="text-sm text-ink-100 truncate">
                  {idx + 1}. {ex.name}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="px-2 py-0.5 text-xs border border-ink-700 rounded text-ink-300 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === order.length - 1}
                    className="px-2 py-0.5 text-xs border border-ink-700 rounded text-ink-300 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100"
          >
            cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
          >
            Send order
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------- Holistic add / remove ----------------

function HolisticFlow({
  token,
  kind,
  library,
  routine: _routine,
  onClose,
}: {
  token: string;
  kind: 'holistic_add' | 'holistic_remove';
  library: LibraryExercise[];
  routine: RoutineForShare;
  onClose: () => void;
}) {
  const [description, setDescription] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!description.trim() && picked.length === 0) return;
    startTransition(async () => {
      try {
        const res = await postShareSuggestion({
          token,
          targetType: 'routine',
          targetId: _routine.id,
          payload: {
            kind,
            description: description.trim() || undefined,
            exerciseIds: picked.length > 0 ? picked : undefined,
          } as never,
        });
        if (res.ok) onClose();
      } catch {
        /* silent */
      }
    });
  };

  const pickedNames = picked
    .map((id) => library.find((e) => e.id === id)?.name ?? id)
    .filter(Boolean);

  return (
    <ModalShell
      title={kind === 'holistic_add' ? 'Suggest things to add' : 'Suggest things to remove'}
      onClose={onClose}
    >
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm text-ink-300">
          Don’t feel like targeting a specific day? Leave a note for the owner and/or tag some
          exercises — they’ll decide where to fit them in.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. 'I'd add some single-leg work; you don't have any.'"
          rows={3}
          className="w-full bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100 resize-none"
        />
        <div>
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="text-xs px-2 py-1 border border-ink-700 rounded-md text-ink-300 hover:text-ink-100"
          >
            {picked.length > 0
              ? `${picked.length} exercise${picked.length === 1 ? '' : 's'} tagged · edit`
              : 'optionally tag specific exercises'}
          </button>
          {pickedNames.length > 0 && (
            <ul className="mt-1 text-xs text-ink-400 list-disc ml-5">
              {pickedNames.slice(0, 5).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              {pickedNames.length > 5 && <li>+{pickedNames.length - 5} more</li>}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100"
          >
            cancel
          </button>
          <button
            type="button"
            disabled={pending || (!description.trim() && picked.length === 0)}
            onClick={submit}
            className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
          >
            Send suggestion
          </button>
        </div>
      </div>
      {showPicker && (
        <ReviewerPicker
          library={library}
          mode="multi"
          title="Tag exercises (optional)"
          onCancel={() => setShowPicker(false)}
          onPickMany={(ids) => {
            setPicked(ids);
            setShowPicker(false);
          }}
        />
      )}
    </ModalShell>
  );
}

// ---------------- Shell + tabs ----------------

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-ink-950 border border-ink-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-3 border-b border-ink-800 flex items-center justify-between">
          <h3 className="font-display text-xl">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-ink-400 hover:text-ink-100"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="px-4 pt-3 pb-1 flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 rounded-md text-xs border transition ${
            value === o.value
              ? 'border-amber-400/60 bg-amber-400/10 text-ink-100'
              : 'border-ink-700 text-ink-300 hover:text-ink-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
