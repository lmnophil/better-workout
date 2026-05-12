'use client';

// Renders the comment + suggestion activity attached to one target (routine,
// day, or template-exercise), plus a small inline comment composer.
//
// Suggestions are rendered as read-only summaries on the share page — the
// owner is the one who acts on them (accept/reject/apply) from their inbox
// view. The reviewer can still see what they (and others) have proposed,
// which keeps the surface honest: "the owner sees X."

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { postShareComment, deleteShareComment, deleteShareSuggestion } from '@/lib/actions';
import type { LibraryExercise } from './reviewer-picker';
import { SuggestionDiffStrip, type SuggestionDiffResult } from './share-coverage';

type Comment = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
};

type Suggestion = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  kind: string;
  payload: Record<string, unknown>;
  state: string;
  createdAt: string;
};

type Props = {
  token: string;
  reviewer: { id: string; displayName: string };
  targetType: 'routine' | 'routine_day' | 'template_exercise';
  targetId: string;
  comments: Comment[];
  suggestions: Suggestion[];
  libraryById: Map<string, LibraryExercise>;
  allowComment?: boolean;
  compact?: boolean;
  // Callback owned by the share view — computes "if this suggestion were
  // accepted, here's the coverage delta". Returning null hides the strip
  // (e.g. for stickers that don't change set count or for sub-trees where
  // the parent decided not to render diffs).
  diffForSuggestion?: (s: {
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    targetId: string | null;
  }) => SuggestionDiffResult | null;
};

export function TargetThread({
  token,
  reviewer,
  targetType,
  targetId,
  comments,
  suggestions,
  libraryById,
  allowComment,
  compact,
  diffForSuggestion,
}: Props) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!body.trim()) return;
    const text = body.trim();
    startTransition(async () => {
      try {
        await postShareComment({ token, targetType, targetId, body: text });
        setBody('');
      } catch {
        /* silent */
      }
    });
  };

  const hasContent = comments.length > 0 || suggestions.length > 0;

  return (
    <div className={compact ? 'mt-2' : ''}>
      {hasContent && (
        <ul className="space-y-1 mb-2">
          {suggestions.map((s) => {
            const mine = s.reviewerId === reviewer.id;
            const canDelete = mine && s.state === 'open';
            // Only show the diff for still-open suggestions — once applied,
            // the routine already reflects the change so the delta would be
            // stale. Once rejected, the change isn't going to happen so the
            // diff isn't useful either.
            const diff =
              s.state === 'open' && diffForSuggestion
                ? diffForSuggestion({
                    id: s.id,
                    kind: s.kind,
                    payload: s.payload,
                    targetId,
                  })
                : null;
            return (
              <li
                key={s.id}
                className="text-xs bg-ink-900/60 border border-ink-800 rounded-md px-2 py-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-300 min-w-0">
                    <span className="text-ink-100 font-medium">{s.reviewerName}</span>{' '}
                    <SuggestionInline kind={s.kind} payload={s.payload} libraryById={libraryById} />
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <SuggestionState state={s.state} />
                    {canDelete && (
                      <DeleteButton
                        label="Remove your suggestion"
                        onConfirm={() => deleteShareSuggestion({ token, suggestionId: s.id })}
                      />
                    )}
                  </span>
                </div>
                {diff && <SuggestionDiffStrip result={diff} />}
              </li>
            );
          })}
          {comments.map((c) => {
            const mine = c.reviewerId === reviewer.id;
            const canDelete = mine && c.resolvedAt === null;
            return (
              <li
                key={c.id}
                className="text-xs bg-ink-900/40 border border-ink-800 rounded-md px-2 py-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-ink-200 min-w-0">
                    <span className="text-ink-100 font-medium">{c.reviewerName}:</span> {c.body}
                  </div>
                  {canDelete && (
                    <DeleteButton
                      label="Remove your comment"
                      onConfirm={() => deleteShareComment({ token, commentId: c.id })}
                    />
                  )}
                </div>
                {c.resolvedAt && (
                  <div className="text-[10px] text-ink-500 mt-0.5">resolved by owner</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {allowComment && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="add a note…"
            maxLength={2000}
            className="flex-1 bg-ink-900 border border-ink-800 rounded-md px-2 py-1 text-xs text-ink-100 focus:outline-none focus:border-ink-600"
          />
          <button
            type="button"
            disabled={pending || !body.trim()}
            onClick={submit}
            className="px-2 py-1 text-xs bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md disabled:opacity-40"
          >
            send
          </button>
        </div>
      )}
    </div>
  );
}

function SuggestionInline({
  kind,
  payload,
  libraryById,
}: {
  kind: string;
  payload: Record<string, unknown>;
  libraryById: Map<string, LibraryExercise>;
}) {
  const nameOf = (id: string | undefined) =>
    id ? (libraryById.get(id)?.name ?? '(unknown exercise)') : '(unknown)';

  switch (kind) {
    case 'swap_specific':
      return (
        <>
          suggested swapping <em>{nameOf(payload.outExerciseId as string)}</em> for{' '}
          <em>{nameOf(payload.inExerciseId as string)}</em>
        </>
      );
    case 'swap_anyof': {
      const ids = (payload.candidateIds as string[] | undefined) ?? [];
      return (
        <>
          suggested swapping <em>{nameOf(payload.outExerciseId as string)}</em> for any of:{' '}
          {ids.map(nameOf).join(', ')}
        </>
      );
    }
    case 'swap_category':
      return (
        <>
          suggested swapping <em>{nameOf(payload.outExerciseId as string)}</em> for any{' '}
          {payload.module ? `${payload.module} ` : ''}exercise
          {payload.primaryMuscle ? ` targeting ${payload.primaryMuscle}` : ''}
        </>
      );
    case 'reorder':
      return <>suggested a new exercise order</>;
    case 'insert': {
      const ids = (payload.exerciseIds as string[] | undefined) ?? [];
      return (
        <>
          suggested inserting at position {Number(payload.atPosition) + 1}:{' '}
          {ids.map(nameOf).join(', ')}
        </>
      );
    }
    case 'remove':
      return <>suggested removing this exercise</>;
    case 'sticker':
      return <>suggested: {String(payload.sticker).replaceAll('_', ' ')}</>;
    case 'custom_exercise':
      return <>suggested a new exercise: {String(payload.name ?? '')}</>;
    case 'holistic_add':
      return <>broad suggestion to add: {String(payload.description ?? 'see tagged items')}</>;
    case 'holistic_remove':
      return <>broad suggestion to remove: {String(payload.description ?? 'see tagged items')}</>;
    default:
      return <>{kind}</>;
  }
}

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            await onConfirm();
          } catch {
            /* silent — page revalidates on success */
          }
        });
      }}
      className="shrink-0 text-ink-500 hover:text-rose-300 transition disabled:opacity-40"
    >
      <X size={12} />
    </button>
  );
}

function SuggestionState({ state }: { state: string }) {
  if (state === 'open') {
    return <span className="text-[10px] text-amber-300/80 uppercase">pending</span>;
  }
  if (state === 'applied') {
    return <span className="text-[10px] text-emerald-300/80 uppercase">applied</span>;
  }
  if (state === 'rejected') {
    return <span className="text-[10px] text-rose-300/80 uppercase">declined</span>;
  }
  return <span className="text-[10px] text-ink-500 uppercase">{state}</span>;
}
