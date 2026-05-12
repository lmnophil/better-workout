'use client';

// Public share view, rendered after the reviewer has registered. Read-only
// routine layout with per-target comment, suggestion, and reaction widgets.
//
// The component intentionally avoids `usePrefs()` (which would require the
// authenticated PrefsProvider). All cosmetic settings are either hard-coded
// or derived from the share payload.

import { useMemo, useState, useTransition } from 'react';
import { MessageCircle, ThumbsUp, Wand2, Plus, Pencil } from 'lucide-react';
import { TargetThread } from './target-thread';
import { SuggestionBuilder } from './suggestion-builder';
import { type LibraryExercise } from './reviewer-picker';
import { StickerStrip } from './sticker-strip';
import { postShareSuggestion, registerShareReviewer, toggleShareReaction } from '@/lib/actions';
import {
  TIME_ESTIMATE,
  estimatePlannedExerciseSeconds,
  formatEstimateCompact,
} from '@/lib/time-estimate';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type RoutineExercise = {
  templateExerciseId: string;
  exerciseId: string;
  name: string;
  module: string;
  metric: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  plannedSets: number | null;
  plannedReps: number | null;
  plannedSeconds: number | null;
  plannedWeight: number | null;
};

export type RoutineForShare = {
  id: string;
  name: string;
  description: string | null;
  scheduleStyle: 'sequence' | 'weekday';
  ownerName: string;
  days: Array<{
    id: string;
    position: number;
    weekday: number | null;
    label: string | null;
    name: string;
    exercises: RoutineExercise[];
  }>;
};

export type ShareActivity = {
  comments: Array<{
    id: string;
    reviewerId: string;
    reviewerName: string;
    targetType: string;
    targetId: string;
    body: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  suggestions: Array<{
    id: string;
    reviewerId: string;
    reviewerName: string;
    kind: string;
    targetType: string | null;
    targetId: string | null;
    payload: Record<string, unknown>;
    state: string;
    createdAt: string;
  }>;
  reactions: Array<{
    id: string;
    reviewerId: string;
    reviewerName: string;
    targetType: string;
    targetId: string;
    kind: string;
  }>;
};

type Props = {
  token: string;
  reviewer: { id: string; displayName: string };
  routine: RoutineForShare;
  activity: ShareActivity;
  library: LibraryExercise[];
};

type BuilderState =
  | { kind: 'none' }
  | {
      kind: 'swap';
      dayId: string;
      outExerciseId: string;
      outName: string;
    }
  | {
      kind: 'insert';
      dayId: string;
      atPosition: number;
    }
  | {
      kind: 'custom';
      dayId: string | null;
    }
  | {
      kind: 'reorder';
      dayId: string;
    }
  | {
      kind: 'holistic_add';
    }
  | {
      kind: 'holistic_remove';
    };

export function ShareView({ token, reviewer, routine, activity, library }: Props) {
  const [builder, setBuilder] = useState<BuilderState>({ kind: 'none' });

  // Build O(1) lookups so per-target panels don't filter the whole list each
  // render. The maps stay small (one share's worth of activity), but the
  // memoization keeps the per-card render cheap as the routine grows.
  const commentsByTarget = useMemo(() => groupByTarget(activity.comments), [activity.comments]);
  const suggestionsByTarget = useMemo(
    () => groupByTarget(activity.suggestions),
    [activity.suggestions],
  );
  const reactionsByTarget = useMemo(
    () => groupReactions(activity.reactions, reviewer.id),
    [activity.reactions, reviewer.id],
  );

  // Library indexed by id so callers can render swap suggestions by name
  // (suggestions store exerciseIds; we need names for display).
  const libraryById = useMemo(() => {
    const map = new Map<string, LibraryExercise>();
    for (const e of library) map.set(e.id, e);
    // Also index exercises already on the routine — those aren't in the
    // built-in library (they may be customs) but reviewers still need names
    // to render suggestions that reference them.
    for (const day of routine.days) {
      for (const ex of day.exercises) {
        if (!map.has(ex.exerciseId)) {
          map.set(ex.exerciseId, {
            id: ex.exerciseId,
            name: ex.name,
            module: ex.module,
            metric: ex.metric === 'time' ? 'time' : 'reps',
            primaryMuscles: ex.primaryMuscles,
            secondaryMuscles: ex.secondaryMuscles,
          });
        }
      }
    }
    return map;
  }, [library, routine]);

  const totalsByDay = useMemo(() => {
    const map = new Map<string, { comments: number; suggestions: number; reactions: number }>();
    for (const d of routine.days) {
      let c = 0;
      let s = 0;
      let r = 0;
      const dayKey = targetKey('routine_day', d.id);
      c += commentsByTarget.get(dayKey)?.length ?? 0;
      s += suggestionsByTarget.get(dayKey)?.length ?? 0;
      r += reactionsByTarget.totals.get(dayKey) ?? 0;
      for (const ex of d.exercises) {
        const exKey = targetKey('template_exercise', ex.templateExerciseId);
        c += commentsByTarget.get(exKey)?.length ?? 0;
        s += suggestionsByTarget.get(exKey)?.length ?? 0;
        r += reactionsByTarget.totals.get(exKey) ?? 0;
      }
      map.set(d.id, { comments: c, suggestions: s, reactions: r });
    }
    return map;
  }, [routine, commentsByTarget, suggestionsByTarget, reactionsByTarget]);

  // Day-level time estimates. The share view doesn't know the owner's rest
  // preference or per-exercise overrides, so it uses the global default. The
  // estimate is "ballpark, at a typical pace" — the on-page tooltip says so.
  const dayEstimateById = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of routine.days) {
      let total = 0;
      for (const ex of d.exercises) {
        total += estimatePlannedExerciseSeconds({
          metric: ex.metric,
          plannedSets: ex.plannedSets,
          plannedReps: ex.plannedReps,
          plannedSeconds: ex.plannedSeconds,
          restSeconds: TIME_ESTIMATE.DEFAULT_REST_S,
        });
      }
      map.set(d.id, total);
    }
    return map;
  }, [routine]);

  const headerCounts = useMemo(() => {
    const c = activity.comments.length;
    const s = activity.suggestions.length;
    const r = activity.reactions.length;
    return { c, s, r };
  }, [activity]);

  return (
    <main className="min-h-screen pb-16">
      {/* Header */}
      <header className="px-5 py-4 border-b border-ink-800">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
          Reviewing for {routine.ownerName}
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <h1 className="font-display text-2xl">{routine.name}</h1>
          <ReviewerNameTag token={token} reviewer={reviewer} />
        </div>
        {routine.description && <p className="text-sm text-ink-300 mt-1">{routine.description}</p>}
        <div className="flex items-center gap-3 text-xs text-ink-400 mt-2">
          <span>
            {headerCounts.c} comment{headerCounts.c === 1 ? '' : 's'}
          </span>
          <span>
            {headerCounts.s} suggestion{headerCounts.s === 1 ? '' : 's'}
          </span>
          <span>{headerCounts.r} 👍</span>
        </div>
      </header>

      {/* Days */}
      {routine.days.map((day) => {
        const dayKey = targetKey('routine_day', day.id);
        const totals = totalsByDay.get(day.id);
        const dayEstimateSec = dayEstimateById.get(day.id) ?? 0;
        return (
          <section key={day.id} className="border-b border-ink-800 px-5 py-5" id={`day-${day.id}`}>
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <div className="min-w-0">
                <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500">
                  {routine.scheduleStyle === 'weekday' && day.weekday !== null
                    ? WEEKDAY[day.weekday]
                    : `Day ${day.position + 1}`}
                  {day.label ? ` · ${day.label}` : ''}
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="font-display text-xl">{day.name}</h2>
                  {dayEstimateSec > 0 && (
                    <span
                      className="text-[11px] text-ink-500 font-mono shrink-0"
                      title="Estimated time at typical pace — sum of planned sets × rest, not a deadline."
                    >
                      ~{formatEstimateCompact(dayEstimateSec)}
                    </span>
                  )}
                </div>
              </div>
              {totals && (totals.comments || totals.suggestions || totals.reactions) ? (
                <div className="text-[11px] text-ink-400 shrink-0">
                  {totals.comments} cmt · {totals.suggestions} sug · {totals.reactions} 👍
                </div>
              ) : null}
            </div>

            {/* Day-level controls */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <SmallButton
                label="reorder this day"
                onClick={() => setBuilder({ kind: 'reorder', dayId: day.id })}
              />
              <SmallButton
                icon={<Plus size={12} />}
                label="insert exercises here"
                onClick={() =>
                  setBuilder({
                    kind: 'insert',
                    dayId: day.id,
                    atPosition: day.exercises.length,
                  })
                }
              />
              <SmallButton
                label="suggest a custom for this day"
                onClick={() => setBuilder({ kind: 'custom', dayId: day.id })}
              />
            </div>

            {/* Day-level thread */}
            <TargetThread
              token={token}
              reviewer={reviewer}
              targetType="routine_day"
              targetId={day.id}
              comments={commentsByTarget.get(dayKey) ?? []}
              suggestions={suggestionsByTarget.get(dayKey) ?? []}
              libraryById={libraryById}
              allowComment
              compact
            />

            {/* Exercises */}
            <ol className="mt-3 space-y-2">
              {day.exercises.map((ex, idx) => {
                const exKey = targetKey('template_exercise', ex.templateExerciseId);
                const myReacted = reactionsByTarget.byReviewer.get(exKey) ?? false;
                const reactionCount = reactionsByTarget.totals.get(exKey) ?? 0;
                return (
                  <li
                    key={ex.templateExerciseId}
                    className="bg-ink-900/60 border border-ink-800 rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] tracking-[0.2em] uppercase text-ink-500">
                          {ex.module}
                        </div>
                        <div className="text-ink-100 font-medium leading-snug">
                          {idx + 1}. {ex.name}
                        </div>
                        <div className="text-xs text-ink-400 mt-0.5">
                          {ex.primaryMuscles.join(', ')}
                          {plannedSummary(ex)}
                        </div>
                      </div>
                      <ReactionToggle
                        token={token}
                        targetType="template_exercise"
                        targetId={ex.templateExerciseId}
                        active={myReacted}
                        count={reactionCount}
                      />
                    </div>

                    {/* Sticker chips (advisory quick-suggestions) */}
                    <StickerStrip
                      token={token}
                      targetType="template_exercise"
                      targetId={ex.templateExerciseId}
                      metric={ex.metric === 'time' ? 'time' : 'reps'}
                    />

                    {/* Per-exercise action row */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <SmallButton
                        icon={<Wand2 size={12} />}
                        label="suggest swap"
                        onClick={() =>
                          setBuilder({
                            kind: 'swap',
                            dayId: day.id,
                            outExerciseId: ex.exerciseId,
                            outName: ex.name,
                          })
                        }
                      />
                      <SmallButton
                        label="suggest remove"
                        onClick={() => quickRemove(token, ex.templateExerciseId, day.id)}
                      />
                      <SmallButton
                        icon={<Plus size={12} />}
                        label="insert after"
                        onClick={() =>
                          setBuilder({
                            kind: 'insert',
                            dayId: day.id,
                            atPosition: idx + 1,
                          })
                        }
                      />
                    </div>

                    {/* Per-exercise thread */}
                    <TargetThread
                      token={token}
                      reviewer={reviewer}
                      targetType="template_exercise"
                      targetId={ex.templateExerciseId}
                      comments={commentsByTarget.get(exKey) ?? []}
                      suggestions={suggestionsByTarget.get(exKey) ?? []}
                      libraryById={libraryById}
                      allowComment
                      compact
                    />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      {/* Routine-level catch-all. Sits *after* the days so it lands where the
          reviewer ends up — they've now read the routine and can leave a
          parting note or a broad-strokes suggestion that doesn't belong on
          any single exercise. */}
      <section className="px-5 py-5 border-b border-ink-800">
        <h2 className="font-display text-lg">Notes on the whole routine</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-3">
          Big-picture feedback that doesn’t fit on a specific exercise — themes,
          balance, things to add or drop overall.
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <SmallButton
            icon={<Plus size={12} />}
            label="suggest something to add"
            onClick={() => setBuilder({ kind: 'holistic_add' })}
          />
          <SmallButton
            icon={<Wand2 size={12} />}
            label="suggest something to drop"
            onClick={() => setBuilder({ kind: 'holistic_remove' })}
          />
          <SmallButton
            icon={<Plus size={12} />}
            label="suggest a new exercise"
            onClick={() => setBuilder({ kind: 'custom', dayId: null })}
          />
        </div>
        <TargetThread
          token={token}
          reviewer={reviewer}
          targetType="routine"
          targetId={routine.id}
          comments={commentsByTarget.get(targetKey('routine', routine.id)) ?? []}
          suggestions={suggestionsByTarget.get(targetKey('routine', routine.id)) ?? []}
          libraryById={libraryById}
          allowComment
        />
      </section>

      {/* Sticky bottom "you reviewed" footer to keep the reviewer oriented. */}
      <div className="fixed bottom-0 inset-x-0 bg-ink-950/90 backdrop-blur border-t border-ink-800 px-5 py-2 flex items-center justify-between text-xs text-ink-300">
        <span>
          you’re <span className="text-ink-100">{reviewer.displayName}</span>
        </span>
        <span>
          <MessageCircle className="inline" size={12} /> {headerCounts.c} ·{' '}
          <Wand2 className="inline" size={12} /> {headerCounts.s} ·{' '}
          <ThumbsUp className="inline" size={12} /> {headerCounts.r}
        </span>
      </div>

      {/* Builder modals */}
      {builder.kind !== 'none' && (
        <SuggestionBuilder
          token={token}
          state={builder}
          routine={routine}
          library={library}
          libraryById={libraryById}
          onClose={() => setBuilder({ kind: 'none' })}
        />
      )}
    </main>
  );
}

// Local helpers — kept inside this file so they don't grow into a shared
// helper module before there's a second consumer.

function targetKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function groupByTarget<T extends { targetType: string | null; targetId: string | null }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.targetType || !row.targetId) continue;
    const k = targetKey(row.targetType, row.targetId);
    const arr = map.get(k);
    if (arr) arr.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function groupReactions(rows: ShareActivity['reactions'], myReviewerId: string) {
  const totals = new Map<string, number>();
  const byReviewer = new Map<string, boolean>();
  for (const row of rows) {
    const k = targetKey(row.targetType, row.targetId);
    totals.set(k, (totals.get(k) ?? 0) + 1);
    if (row.reviewerId === myReviewerId) byReviewer.set(k, true);
  }
  return { totals, byReviewer };
}

function plannedSummary(ex: RoutineExercise): string {
  const parts: string[] = [];
  if (ex.plannedSets != null) parts.push(`${ex.plannedSets} sets`);
  if (ex.metric === 'time') {
    if (ex.plannedSeconds != null) parts.push(`${ex.plannedSeconds}s`);
  } else {
    if (ex.plannedReps != null) parts.push(`${ex.plannedReps} reps`);
    if (ex.plannedWeight != null) {
      parts.push(ex.plannedWeight === 0 ? 'bodyweight' : `${ex.plannedWeight}`);
    }
  }
  return parts.length > 0 ? ' · ' + parts.join(' · ') : '';
}

function quickRemove(token: string, templateExerciseId: string, _dayId: string) {
  // Reviewer fires this off without confirmation — it's a *suggestion*, not
  // an applied change. The owner still has to accept on their side.
  postShareSuggestion({
    token,
    targetType: 'template_exercise',
    targetId: templateExerciseId,
    payload: { kind: 'remove', templateExerciseId },
  }).catch(() => {
    // The page revalidates on success; failures are quiet by design (we
    // don't have a toast system on the share page, and the reviewer can
    // try again).
  });
}

function ReactionToggle({
  token,
  targetType,
  targetId,
  active,
  count,
}: {
  token: string;
  targetType: 'template_exercise' | 'routine_day' | 'routine';
  targetId: string;
  active: boolean;
  count: number;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            await toggleShareReaction({ token, targetType, targetId, kind: 'good' });
          } catch {
            /* silent — see quickRemove */
          }
        });
      }}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition ${
        active
          ? 'border-amber-400/60 text-amber-300 bg-amber-400/10'
          : 'border-ink-700 text-ink-400 hover:text-ink-200'
      } disabled:opacity-50`}
    >
      <ThumbsUp size={12} /> {count > 0 ? count : 'good'}
    </button>
  );
}

function ReviewerNameTag({
  token,
  reviewer,
}: {
  token: string;
  reviewer: { id: string; displayName: string };
}) {
  // The reviewer's display name is editable in place. `registerShareReviewer`
  // already updates the row when called again with the same cookie, so we
  // reuse it instead of adding a separate rename action.
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reviewer.displayName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(reviewer.displayName);
          setError(null);
          setEditing(true);
        }}
        className="text-xs text-ink-400 hover:text-ink-100 inline-flex items-center gap-1"
        title="Change the name owners see on your activity"
      >
        you’re <span className="text-ink-100">{reviewer.displayName}</span>
        <Pencil size={11} className="opacity-60" />
      </button>
    );
  }

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Pick a name.');
      return;
    }
    if (trimmed === reviewer.displayName) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await registerShareReviewer({ token, displayName: trimmed });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          autoFocus
          maxLength={40}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setValue(reviewer.displayName);
              setError(null);
              setEditing(false);
            }
          }}
          className="bg-ink-900 border border-ink-700 rounded-md px-2 py-1 text-xs text-ink-100 focus:outline-none focus:border-ink-500 w-32"
        />
        <button
          type="button"
          onClick={commit}
          disabled={pending}
          className="text-xs px-2 py-1 rounded-md bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium disabled:opacity-50"
        >
          save
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}

function SmallButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-ink-700 text-ink-300 hover:text-ink-100 hover:border-ink-500 text-[11px]"
    >
      {icon}
      {label}
    </button>
  );
}
