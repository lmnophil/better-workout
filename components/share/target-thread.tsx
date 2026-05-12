'use client';

// Renders the comment + suggestion activity attached to one target (routine,
// day, or template-exercise), plus a small inline comment composer.
//
// Suggestions are rendered as read-only summaries on the share page — the
// owner is the one who acts on them (accept/reject/apply) from their inbox
// view. The reviewer can still see what they (and others) have proposed,
// which keeps the surface honest: "the owner sees X."

import { useState, useTransition } from 'react';
import { postShareComment } from '@/lib/actions';
import type { LibraryExercise } from './reviewer-picker';

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
};

export function TargetThread({
  token,
  targetType,
  targetId,
  comments,
  suggestions,
  libraryById,
  allowComment,
  compact,
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
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="text-xs bg-ink-900/60 border border-ink-800 rounded-md px-2 py-1.5 flex items-baseline justify-between gap-2"
            >
              <span className="text-ink-300">
                <span className="text-ink-100 font-medium">{s.reviewerName}</span>{' '}
                <SuggestionInline kind={s.kind} payload={s.payload} libraryById={libraryById} />
              </span>
              <SuggestionState state={s.state} />
            </li>
          ))}
          {comments.map((c) => (
            <li
              key={c.id}
              className="text-xs bg-ink-900/40 border border-ink-800 rounded-md px-2 py-1.5"
            >
              <div className="text-ink-200">
                <span className="text-ink-100 font-medium">{c.reviewerName}:</span> {c.body}
              </div>
              {c.resolvedAt && (
                <div className="text-[10px] text-ink-500 mt-0.5">resolved by owner</div>
              )}
            </li>
          ))}
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
