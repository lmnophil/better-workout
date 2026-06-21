'use client';

// Reviewer-facing exercise picker. Independent of the main workout picker —
// no usePrefs (this surface is unauthenticated), no time estimates, no
// custom-create tab (the reviewer creates customs through the suggestion
// flow, not by editing the owner's library).
//
// Exercises are grouped by module and, within each module, sorted by primary
// muscle so swap candidates cluster together. When `primaryMuscleHint` is
// passed (i.e. the reviewer is picking a replacement for an existing
// exercise), modules with matching primary-muscle exercises sort to the top.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { ModalShell } from '@/components/ui/modal-shell';

export type LibraryExercise = {
  id: string;
  name: string;
  module: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  metric: string;
};

type Props = {
  library: LibraryExercise[];
  // Single-select fires onPick once. Multi-select fires onPickMany on commit
  // and keeps the picker open until the user commits or cancels.
  mode: 'single' | 'multi';
  // Optional: exclude these ids (e.g. the exercise the reviewer wants to swap
  // *away from* shouldn't be a swap candidate).
  excludeIds?: Set<string>;
  // Optional: a primary-muscle string to prefer in the top results. Used by
  // the swap flow so candidates that share the outgoing exercise's primary
  // muscle surface first.
  primaryMuscleHint?: string;
  onCancel: () => void;
  // The handler may be async; the picker wraps the call in Promise.resolve and
  // awaits it so the commit button can show a submitting state and a double-tap
  // can't file two suggestions. Typed `=> void` because an async function is
  // assignable to it and the strict ruleset rejects a `void` union.
  onPick?: (exerciseId: string) => void;
  onPickMany?: (exerciseIds: string[]) => void;
  title: string;
};

export function ReviewerPicker({
  library,
  mode,
  excludeIds,
  primaryMuscleHint,
  onCancel,
  onPick,
  onPickMany,
  title,
}: Props) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // Picking commits and the parent closes us on success; guard setState after
  // that unmount.
  const mountedRef = useRef(true);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filtered = library.filter((e) => {
      if (excludeIds?.has(e.id)) return false;
      if (!ql) return true;
      return (
        e.name.toLowerCase().includes(ql) ||
        e.primaryMuscles.some((m) => m.toLowerCase().includes(ql)) ||
        e.secondaryMuscles.some((m) => m.toLowerCase().includes(ql)) ||
        e.module.toLowerCase().includes(ql)
      );
    });

    const byModule = new Map<string, LibraryExercise[]>();
    for (const e of filtered) {
      let bucket = byModule.get(e.module);
      if (!bucket) {
        bucket = [];
        byModule.set(e.module, bucket);
      }
      bucket.push(e);
    }
    // Within each module: sort by primary muscle, then name. If a muscle hint
    // is provided, surface matching exercises first within their module.
    for (const [, arr] of byModule) {
      arr.sort((a, b) => {
        const aHit = primaryMuscleHint ? (a.primaryMuscles.includes(primaryMuscleHint) ? 0 : 1) : 0;
        const bHit = primaryMuscleHint ? (b.primaryMuscles.includes(primaryMuscleHint) ? 0 : 1) : 0;
        if (aHit !== bHit) return aHit - bHit;
        const am = a.primaryMuscles[0] ?? '';
        const bm = b.primaryMuscles[0] ?? '';
        if (am !== bm) return am.localeCompare(bm);
        return a.name.localeCompare(b.name);
      });
    }
    // Order modules: any module with a primary-muscle-hit comes first if a
    // hint is set. Otherwise, preserve insertion order (which mirrors the
    // library's sort order).
    const entries = Array.from(byModule.entries());
    if (primaryMuscleHint) {
      entries.sort(([, a], [, b]) => {
        const aHit = a.some((e) => e.primaryMuscles.includes(primaryMuscleHint));
        const bHit = b.some((e) => e.primaryMuscles.includes(primaryMuscleHint));
        if (aHit && !bHit) return -1;
        if (!aHit && bHit) return 1;
        return 0;
      });
    }
    return entries.map(([module, exercises]) => ({ module, exercises }));
  }, [library, excludeIds, q, primaryMuscleHint]);

  // Single-select commits instantly; await it so a double-tap (or tapping a
  // second row before the first post lands) can't file two suggestions.
  const toggle = (id: string) => {
    if (mode === 'single') {
      if (submitting) return;
      setSubmitting(true);
      Promise.resolve(onPick?.(id)).finally(() => {
        if (mountedRef.current) setSubmitting(false);
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commit = () => {
    if (mode !== 'multi' || selected.size === 0 || submitting) return;
    setSubmitting(true);
    Promise.resolve(onPickMany?.(Array.from(selected))).finally(() => {
      if (mountedRef.current) setSubmitting(false);
    });
  };

  return (
    <ModalShell
      onClose={onCancel}
      isSubmitting={submitting}
      ariaLabel={title}
      panelClassName="rounded-t-2xl sm:rounded-2xl sm:max-w-lg sm:mx-4 max-h-[90vh] flex flex-col"
    >
      <div className="px-4 pt-4 pb-3 border-b border-ink-800 flex items-center justify-between">
        <h3 className="font-display text-xl">{title}</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="p-1 text-ink-400 hover:text-ink-100"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-3 border-b border-ink-800">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            ref={searchRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search exercises or muscles"
            className="w-full bg-ink-900 border border-ink-700 rounded-md pl-8 pr-3 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-ink-500"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 && (
          <div className="text-ink-400 text-sm py-6 text-center">No matches.</div>
        )}
        {groups.map(({ module, exercises }) => (
          <div key={module} className="mb-4">
            <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-1">
              {module}
            </div>
            <ul className="space-y-1">
              {exercises.map((e) => {
                const isSelected = selected.has(e.id);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      disabled={submitting}
                      className={`w-full text-left px-2 py-1.5 rounded-md border text-sm flex items-center justify-between transition disabled:opacity-50 ${
                        isSelected
                          ? 'border-amber-400/60 bg-amber-400/10 text-ink-100'
                          : 'border-ink-800 hover:border-ink-600 text-ink-200'
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-ink-100">{e.name}</span>
                        <span className="text-ink-400 text-xs ml-2">
                          {e.primaryMuscles.join(', ')}
                        </span>
                      </span>
                      {mode === 'multi' && isSelected && (
                        <Check size={14} className="text-amber-300" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {mode === 'multi' && (
        <div className="px-4 py-3 border-t border-ink-800 flex items-center justify-between">
          <div className="text-xs text-ink-400">
            {selected.size === 0 ? 'pick one or more' : `${selected.size} selected`}
          </div>
          <button
            type="button"
            onClick={commit}
            disabled={selected.size === 0 || submitting}
            className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
          >
            {submitting
              ? 'Sending…'
              : `Use ${selected.size > 0 ? `${selected.size} ` : ''}exercise${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </ModalShell>
  );
}
