'use client';

// Owner-side review surface. Renders open suggestions, comments, and
// reactions with one-click apply/reject/resolve. Structured swaps,
// reorders, inserts, removes, and custom-exercise proposals get an apply
// button. Stickers and holistic suggestions get only resolve/reject.

import { useState } from 'react';
import {
  applyShareSwap,
  applyShareReorder,
  applyShareInsert,
  applyShareRemove,
  applyShareCustomExercise,
  rejectShareSuggestion,
  resolveShareSuggestion,
  resolveShareComment,
} from '@/lib/actions';
import { useAction } from '@/components/ui/use-action';

type Comment = {
  id: string;
  reviewerName: string;
  targetType: string;
  targetId: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
};

type Suggestion = {
  id: string;
  reviewerName: string;
  kind: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  state: string;
  createdAt: string;
};

type Reaction = {
  id: string;
  reviewerName: string;
  targetType: string;
  targetId: string;
};

type Props = {
  shareId: string;
  comments: Comment[];
  suggestions: Suggestion[];
  reactions: Reaction[];
  labelByTarget: Record<string, string>;
  exerciseNameById: Record<string, string>;
  dayChoices: Array<{ id: string; name: string; position: number }>;
};

export function ShareDetail({
  comments,
  suggestions,
  reactions,
  labelByTarget,
  exerciseNameById,
  dayChoices,
}: Props) {
  const openSuggestions = suggestions.filter((s) => s.state === 'open');
  const closedSuggestions = suggestions.filter((s) => s.state !== 'open');
  const openComments = comments.filter((c) => !c.resolvedAt);
  const resolvedComments = comments.filter((c) => c.resolvedAt);

  return (
    <div className="space-y-6">
      <Section
        title={`Open suggestions (${openSuggestions.length})`}
        dim={openSuggestions.length === 0}
      >
        {openSuggestions.length === 0 ? (
          <Empty>No open suggestions.</Empty>
        ) : (
          <ul className="space-y-2">
            {openSuggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                s={s}
                labelByTarget={labelByTarget}
                exerciseNameById={exerciseNameById}
                dayChoices={dayChoices}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Open comments (${openComments.length})`} dim={openComments.length === 0}>
        {openComments.length === 0 ? (
          <Empty>No open comments.</Empty>
        ) : (
          <ul className="space-y-2">
            {openComments.map((c) => (
              <CommentCard key={c.id} c={c} labelByTarget={labelByTarget} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Reactions (${reactions.length})`} dim={reactions.length === 0} collapsed>
        {reactions.length === 0 ? (
          <Empty>No reactions yet.</Empty>
        ) : (
          <ReactionList reactions={reactions} labelByTarget={labelByTarget} />
        )}
      </Section>

      {(closedSuggestions.length > 0 || resolvedComments.length > 0) && (
        <Section
          title={`History (${closedSuggestions.length + resolvedComments.length})`}
          dim
          collapsed
        >
          <ul className="space-y-1 text-xs text-ink-400">
            {closedSuggestions.map((s) => (
              <li key={s.id}>
                <span className="text-ink-200">{s.reviewerName}</span>: {humanKind(s.kind)} —{' '}
                <span
                  className={
                    s.state === 'applied'
                      ? 'text-emerald-300/80'
                      : s.state === 'rejected'
                        ? 'text-rose-300/80'
                        : ''
                  }
                >
                  {s.state}
                </span>
              </li>
            ))}
            {resolvedComments.map((c) => (
              <li key={c.id}>
                <span className="text-ink-200">{c.reviewerName}</span>: “{c.body.slice(0, 60)}” —
                resolved
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  dim,
  collapsed,
}: {
  title: string;
  children: React.ReactNode;
  dim?: boolean;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <details open={!dim} className={dim ? 'opacity-70' : ''}>
        <summary className="font-display text-lg cursor-pointer">{title}</summary>
        <div className="mt-2">{children}</div>
      </details>
    );
  }
  return (
    <div className={dim ? 'opacity-70' : ''}>
      <h2 className="font-display text-lg mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-ink-500 text-sm">{children}</div>;
}

// ---------------- Suggestion card ----------------

function SuggestionCard({
  s,
  labelByTarget,
  exerciseNameById,
  dayChoices,
}: {
  s: Suggestion;
  labelByTarget: Record<string, string>;
  exerciseNameById: Record<string, string>;
  dayChoices: Array<{ id: string; name: string; position: number }>;
}) {
  // run/isPending/error from useAction: an apply or reject failure (the
  // suggestion already actioned in another tab, an exercise removed since) now
  // surfaces in the card instead of being silently dropped.
  const { run, isPending: pending, error } = useAction();
  const [pickedSwap, setPickedSwap] = useState<string | null>(null);
  const [pickedInserts, setPickedInserts] = useState<Record<string, boolean>>({});
  const [customDayId, setCustomDayId] = useState<string | null>(null);

  const targetLabel =
    s.targetType && s.targetId ? labelByTarget[`${s.targetType}:${s.targetId}`] : null;

  const reject = () => run(() => rejectShareSuggestion({ suggestionId: s.id }));
  const resolve = () => run(() => resolveShareSuggestion({ suggestionId: s.id }));

  return (
    <li id={`suggestion-${s.id}`} className="bg-ink-900/40 border border-ink-800 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-xs text-ink-400">
          <span className="text-ink-100 font-medium">{s.reviewerName}</span> ·{' '}
          {new Date(s.createdAt).toLocaleString()}
          {targetLabel && (
            <>
              {' '}
              · on <span className="text-ink-200">{targetLabel}</span>
            </>
          )}
        </div>
        <span className="text-[10px] text-amber-300/80 uppercase">open</span>
      </div>

      <div className="text-sm text-ink-100 mb-3">
        <SuggestionSummary s={s} exerciseNameById={exerciseNameById} />
      </div>

      {/* Action affordances depending on suggestion kind */}
      {(s.kind === 'swap_specific' || s.kind === 'swap_anyof') && (
        <div className="space-y-2">
          {s.kind === 'swap_anyof' && (
            <CandidatePicker
              candidates={(s.payload.candidateIds as string[] | undefined) ?? []}
              exerciseNameById={exerciseNameById}
              picked={pickedSwap}
              onPick={setPickedSwap}
            />
          )}
          <ActionRow>
            <ApplyButton
              disabled={pending || (s.kind === 'swap_anyof' && !pickedSwap)}
              onClick={() =>
                run(() =>
                  applyShareSwap({
                    suggestionId: s.id,
                    inExerciseId:
                      s.kind === 'swap_specific'
                        ? (s.payload.inExerciseId as string | undefined)
                        : (pickedSwap ?? undefined),
                  }),
                )
              }
            />
            <RejectButton disabled={pending} onClick={reject} />
          </ActionRow>
        </div>
      )}

      {s.kind === 'swap_category' && (
        <ActionRow>
          <span className="text-xs text-ink-400">
            Pick a replacement on the routine page, then resolve this suggestion.
          </span>
          <ResolveButton disabled={pending} onClick={resolve} />
          <RejectButton disabled={pending} onClick={reject} />
        </ActionRow>
      )}

      {s.kind === 'reorder' && (
        <ActionRow>
          <ApplyButton
            disabled={pending}
            onClick={() => run(() => applyShareReorder({ suggestionId: s.id }))}
          />
          <RejectButton disabled={pending} onClick={reject} />
        </ActionRow>
      )}

      {s.kind === 'insert' && (
        <div className="space-y-2">
          <InsertPicker
            candidates={(s.payload.exerciseIds as string[] | undefined) ?? []}
            exerciseNameById={exerciseNameById}
            picked={pickedInserts}
            onToggle={(id) => setPickedInserts((prev) => ({ ...prev, [id]: !prev[id] }))}
          />
          <ActionRow>
            <ApplyButton
              disabled={pending}
              onClick={() =>
                run(() =>
                  applyShareInsert({
                    suggestionId: s.id,
                    exerciseIds:
                      Object.entries(pickedInserts)
                        .filter(([, v]) => v)
                        .map(([k]) => k) || undefined,
                  }),
                )
              }
              label={Object.values(pickedInserts).some((v) => v) ? `Apply selected` : `Apply all`}
            />
            <RejectButton disabled={pending} onClick={reject} />
          </ActionRow>
        </div>
      )}

      {s.kind === 'remove' && (
        <ActionRow>
          <ApplyButton
            disabled={pending}
            onClick={() => run(() => applyShareRemove({ suggestionId: s.id }))}
          />
          <RejectButton disabled={pending} onClick={reject} />
        </ActionRow>
      )}

      {s.kind === 'custom_exercise' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-400">Insert into:</span>
            <select
              value={customDayId ?? ''}
              onChange={(e) => setCustomDayId(e.target.value || null)}
              className="bg-ink-900 border border-ink-700 rounded-md px-2 py-1 text-ink-100"
            >
              <option value="">(don’t insert — just add to library)</option>
              {dayChoices.map((d) => (
                <option key={d.id} value={d.id}>
                  Day {d.position + 1} · {d.name}
                </option>
              ))}
            </select>
          </div>
          <ActionRow>
            <ApplyButton
              disabled={pending}
              onClick={() =>
                run(() =>
                  applyShareCustomExercise({
                    suggestionId: s.id,
                    insertIntoRoutineDayId: customDayId ?? undefined,
                  }),
                )
              }
              label={customDayId ? 'Create + insert' : 'Create exercise'}
            />
            <RejectButton disabled={pending} onClick={reject} />
          </ActionRow>
        </div>
      )}

      {(s.kind === 'sticker' || s.kind === 'holistic_add' || s.kind === 'holistic_remove') && (
        <ActionRow>
          <span className="text-xs text-ink-400">
            Advisory — hand-edit the routine if you want to act on it.
          </span>
          <ResolveButton disabled={pending} onClick={resolve} />
          <RejectButton disabled={pending} onClick={reject} />
        </ActionRow>
      )}
      {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
    </li>
  );
}

function CandidatePicker({
  candidates,
  exerciseNameById,
  picked,
  onPick,
}: {
  candidates: string[];
  exerciseNameById: Record<string, string>;
  picked: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-xs text-ink-400 mb-1">Pick which one to swap in:</div>
      <div className="flex flex-wrap gap-1">
        {candidates.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className={`px-2 py-1 text-xs rounded-md border ${
              picked === id
                ? 'border-amber-400/60 bg-amber-400/10 text-ink-100'
                : 'border-ink-700 text-ink-300 hover:text-ink-100'
            }`}
          >
            {exerciseNameById[id] ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}

function InsertPicker({
  candidates,
  exerciseNameById,
  picked,
  onToggle,
}: {
  candidates: string[];
  exerciseNameById: Record<string, string>;
  picked: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-xs text-ink-400 mb-1">Select which to insert (none selected = all):</div>
      <div className="flex flex-wrap gap-1">
        {candidates.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            className={`px-2 py-1 text-xs rounded-md border ${
              picked[id]
                ? 'border-amber-400/60 bg-amber-400/10 text-ink-100'
                : 'border-ink-700 text-ink-300 hover:text-ink-100'
            }`}
          >
            {exerciseNameById[id] ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>;
}

function ApplyButton({
  onClick,
  disabled,
  label = 'Apply',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 text-xs bg-emerald-500/90 hover:bg-emerald-500 text-ink-950 font-medium rounded-md disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function RejectButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 text-xs border border-ink-700 text-ink-300 hover:text-rose-300 rounded-md disabled:opacity-40"
    >
      Decline
    </button>
  );
}

function ResolveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 text-xs border border-ink-700 text-ink-300 hover:text-ink-100 rounded-md disabled:opacity-40"
    >
      Mark resolved
    </button>
  );
}

// ---------------- Comment card ----------------

function CommentCard({ c, labelByTarget }: { c: Comment; labelByTarget: Record<string, string> }) {
  const { run, isPending: pending } = useAction();
  const targetLabel = labelByTarget[`${c.targetType}:${c.targetId}`];

  const resolve = () => run(() => resolveShareComment({ commentId: c.id }));

  return (
    <li id={`comment-${c.id}`} className="bg-ink-900/40 border border-ink-800 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-xs text-ink-400">
          <span className="text-ink-100 font-medium">{c.reviewerName}</span> ·{' '}
          {new Date(c.createdAt).toLocaleString()}
          {targetLabel && (
            <>
              {' '}
              · on <span className="text-ink-200">{targetLabel}</span>
            </>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-100">{c.body}</p>
      <div className="mt-2">
        <button
          type="button"
          onClick={resolve}
          disabled={pending}
          className="px-2 py-1 text-xs border border-ink-700 text-ink-300 hover:text-ink-100 rounded-md disabled:opacity-40"
        >
          Mark resolved
        </button>
      </div>
    </li>
  );
}

// ---------------- Reactions ----------------

function ReactionList({
  reactions,
  labelByTarget,
}: {
  reactions: Reaction[];
  labelByTarget: Record<string, string>;
}) {
  const grouped = new Map<string, Reaction[]>();
  for (const r of reactions) {
    const k = `${r.targetType}:${r.targetId}`;
    const arr = grouped.get(k);
    if (arr) arr.push(r);
    else grouped.set(k, [r]);
  }
  return (
    <ul className="space-y-1 text-xs text-ink-300">
      {Array.from(grouped.entries()).map(([k, group]) => (
        <li key={k}>
          <span className="text-ink-100">{labelByTarget[k] ?? k}</span>: 👍 by{' '}
          {group.map((r) => r.reviewerName).join(', ')}
        </li>
      ))}
    </ul>
  );
}

// ---------------- Helpers ----------------

function humanKind(kind: string): string {
  switch (kind) {
    case 'swap_specific':
      return 'swap (specific)';
    case 'swap_anyof':
      return 'swap (any of)';
    case 'swap_category':
      return 'swap (category)';
    case 'reorder':
      return 'reorder';
    case 'insert':
      return 'insert';
    case 'remove':
      return 'remove';
    case 'sticker':
      return 'sticker';
    case 'custom_exercise':
      return 'custom exercise';
    case 'holistic_add':
      return 'holistic add';
    case 'holistic_remove':
      return 'holistic remove';
    default:
      return kind;
  }
}

function SuggestionSummary({
  s,
  exerciseNameById,
}: {
  s: Suggestion;
  exerciseNameById: Record<string, string>;
}) {
  const nameOf = (id: unknown) =>
    typeof id === 'string' ? (exerciseNameById[id] ?? '(unknown exercise)') : '(unknown)';

  switch (s.kind) {
    case 'swap_specific':
      return (
        <>
          Swap <em>{nameOf(s.payload.outExerciseId)}</em> for{' '}
          <em>{nameOf(s.payload.inExerciseId)}</em>
        </>
      );
    case 'swap_anyof':
      return (
        <>
          Swap <em>{nameOf(s.payload.outExerciseId)}</em> for any of:{' '}
          {(s.payload.candidateIds as string[] | undefined)?.map(nameOf).join(', ')}
        </>
      );
    case 'swap_category':
      return (
        <>
          Swap <em>{nameOf(s.payload.outExerciseId)}</em> for any{' '}
          {s.payload.module ? `${s.payload.module} ` : ''}exercise
          {s.payload.primaryMuscle ? ` targeting ${s.payload.primaryMuscle}` : ''}
        </>
      );
    case 'reorder':
      return <>Reorder this day’s exercises</>;
    case 'insert': {
      const ids = (s.payload.exerciseIds as string[] | undefined) ?? [];
      return (
        <>
          Insert at position {Number(s.payload.atPosition) + 1}: {ids.map(nameOf).join(', ')}
        </>
      );
    }
    case 'remove':
      return <>Remove this exercise</>;
    case 'sticker':
      return (
        <>
          Quick suggestion: <em>{String(s.payload.sticker).replaceAll('_', ' ')}</em>
          {s.payload.note ? ` — ${String(s.payload.note)}` : ''}
        </>
      );
    case 'custom_exercise':
      return (
        <>
          New custom: <em>{String(s.payload.name)}</em>
          {Array.isArray(s.payload.primaryMuscles) && s.payload.primaryMuscles.length > 0 && (
            <> · {(s.payload.primaryMuscles as string[]).join(', ')}</>
          )}
          {s.payload.notes ? <> — {String(s.payload.notes)}</> : null}
        </>
      );
    case 'holistic_add':
      return (
        <>
          Broad add: {String(s.payload.description ?? '')}
          {Array.isArray(s.payload.exerciseIds) && s.payload.exerciseIds.length > 0 && (
            <> · tagged: {(s.payload.exerciseIds as string[]).map(nameOf).join(', ')}</>
          )}
        </>
      );
    case 'holistic_remove':
      return (
        <>
          Broad remove: {String(s.payload.description ?? '')}
          {Array.isArray(s.payload.exerciseIds) && s.payload.exerciseIds.length > 0 && (
            <> · tagged: {(s.payload.exerciseIds as string[]).map(nameOf).join(', ')}</>
          )}
        </>
      );
    default:
      return <>{s.kind}</>;
  }
}
