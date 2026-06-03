'use client';

// Pool-pick dialog — shown when starting a workout from a routine day that has
// one or more "pick X of N" pools. For each pool the user picks which members
// to do today; the dialog surfaces last-done date + trailing-year session
// count so the choice is recency-assisted (rotate what's gone stale, drop what
// you rarely touch). The app doesn't auto-pick — it just shows the signal.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, X } from 'lucide-react';
import { relativeDay } from '@/lib/utils';

export type PoolPickMember = {
  exerciseId: string;
  name: string;
  // null = not logged in the trailing year (the usage query's window).
  lastDoneDate: Date | null;
  sessionCount: number;
};

export type PoolForPick = {
  id: string;
  label: string | null;
  pickCount: number;
  members: PoolPickMember[];
};

// Sort least-recently-done first so rotation candidates surface at the top:
// never-done before done, then oldest date before newest.
function byStaleness(a: PoolPickMember, b: PoolPickMember): number {
  if (a.lastDoneDate === null && b.lastDoneDate === null) return a.name.localeCompare(b.name);
  if (a.lastDoneDate === null) return -1;
  if (b.lastDoneDate === null) return 1;
  return a.lastDoneDate.getTime() - b.lastDoneDate.getTime();
}

export function PoolPickDialog({
  dayName,
  pools,
  isPending,
  error,
  onConfirm,
  onCancel,
}: {
  dayName: string;
  pools: PoolForPick[];
  isPending: boolean;
  error: string | null;
  onConfirm: (picks: { poolId: string; exerciseIds: string[] }[]) => void;
  onCancel: () => void;
}) {
  const sortedPools = useMemo(
    () => pools.map((p) => ({ ...p, members: [...p.members].sort(byStaleness) })),
    [pools],
  );

  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const p of pools) init[p.id] = new Set<string>();
    return init;
  });

  // A11y: this is a modal, so focus has to live inside it. On open we move
  // focus into the dialog and remember what had it (the "Start this workout"
  // button), then restore that on close so keyboard users land back where they
  // were. Escape closes (matching the backdrop/✕, including the isPending
  // guard), and Tab is trapped so it can't wander onto the page behind.
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!isPending) onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        // Nothing tabbable (every control disabled while pending) — keep focus
        // pinned to the dialog rather than letting it escape to the page.
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === dialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPending, onCancel]);

  // How many a pool needs today — its pickCount, capped at the member count in
  // case a member was soft-deleted out from under it.
  function needFor(pool: PoolForPick): number {
    return Math.min(pool.pickCount, pool.members.length);
  }

  function pick(poolId: string, exerciseId: string, need: number) {
    setSelections((prev) => {
      // A "do 1" pool is a radio group: tapping a member just makes it the one,
      // replacing whatever was picked. No toggle-off — a pool with zero picks
      // can't start, so there's nothing to express by un-picking the sole pick.
      if (need === 1) {
        return { ...prev, [poolId]: new Set([exerciseId]) };
      }
      const current = prev[poolId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        // At cap, swap out the oldest pick rather than ignoring the tap — the
        // user can switch a pick without first hunting for the one to un-tick.
        // Set preserves insertion order, so the first entry is the oldest.
        if (next.size >= need) {
          const oldest = next.values().next().value;
          if (oldest !== undefined) next.delete(oldest);
        }
        next.add(exerciseId);
      }
      return { ...prev, [poolId]: next };
    });
  }

  const allResolved = sortedPools.every((p) => (selections[p.id]?.size ?? 0) === needFor(p));

  function handleConfirm() {
    if (!allResolved) return;
    onConfirm(
      sortedPools.map((p) => ({
        poolId: p.id,
        exerciseIds: Array.from(selections[p.id] ?? []),
      })),
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center"
      onClick={() => !isPending && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-label={`Pick exercises for ${dayName}`}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-ink-950 border border-ink-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 max-h-[90vh] flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-ink-800 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="font-display text-2xl truncate">Pick your exercises</h2>
            <p className="text-xs text-ink-500 italic font-display mt-0.5 truncate">
              {dayName} has {pools.length} {pools.length === 1 ? 'pool' : 'pools'} to resolve.
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={isPending}
            className="text-ink-500 hover:text-ink-100 transition p-2 -mr-2 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {sortedPools.map((pool) => {
            const need = needFor(pool);
            const isRadio = need === 1;
            const picked = selections[pool.id]?.size ?? 0;
            return (
              <div key={pool.id} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm text-ink-100">
                    {pool.label?.trim() || 'Exercise pool'}
                  </div>
                  <div
                    className={`text-[11px] font-mono ${
                      picked === need ? 'accent-text' : 'text-ink-500'
                    }`}
                  >
                    {picked} / {need}
                  </div>
                </div>
                {/* A "do 1" pool is a single-choice group, so it's a radiogroup
                    with round indicators; "do N" pools stay multi-select
                    checkboxes. Either way a tap at cap swaps rather than being
                    refused, so no member is ever disabled (except while the
                    start action is in flight). */}
                <div
                  className="space-y-1.5"
                  role={isRadio ? 'radiogroup' : undefined}
                  aria-label={isRadio ? pool.label?.trim() || 'Exercise pool' : undefined}
                >
                  {pool.members.map((m) => {
                    const checked = selections[pool.id]?.has(m.exerciseId) ?? false;
                    return (
                      <button
                        key={m.exerciseId}
                        type="button"
                        onClick={() => pick(pool.id, m.exerciseId, need)}
                        disabled={isPending}
                        role={isRadio ? 'radio' : undefined}
                        aria-checked={isRadio ? checked : undefined}
                        aria-pressed={isRadio ? undefined : checked}
                        className={`w-full text-left rounded-lg border px-3 py-2 flex items-center gap-3 transition ${
                          checked
                            ? 'accent-border bg-accent/5'
                            : 'border-ink-800 hover:border-accent/40'
                        }`}
                      >
                        <span
                          className={`shrink-0 w-5 h-5 border flex items-center justify-center transition ${
                            isRadio ? 'rounded-full' : 'rounded'
                          } ${
                            checked
                              ? isRadio
                                ? 'accent-border'
                                : 'accent-bg accent-border'
                              : 'border-ink-700'
                          }`}
                          aria-hidden="true"
                        >
                          {checked &&
                            (isRadio ? (
                              <span className="w-2.5 h-2.5 rounded-full accent-bg" />
                            ) : (
                              <Check size={13} strokeWidth={3} className="text-ink-950" />
                            ))}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="text-sm text-ink-100 block truncate">{m.name}</span>
                          <span className="text-[10px] font-mono text-ink-500">
                            {m.lastDoneDate
                              ? `${relativeDay(m.lastDoneDate)} · ${m.sessionCount}×`
                              : 'not done yet'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-ink-800 px-5 py-3 space-y-2">
          {error && <p className="text-[11px] text-bad">{error}</p>}
          <button
            onClick={handleConfirm}
            disabled={!allResolved || isPending}
            className="w-full accent-bg text-ink-950 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Play size={13} strokeWidth={3} />
            {allResolved ? 'Start this workout' : 'Pick from every pool to start'}
          </button>
        </div>
      </div>
    </div>
  );
}
