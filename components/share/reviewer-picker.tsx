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

import { useEffect, useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

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
      if (!byModule.has(e.module)) byModule.set(e.module, []);
      byModule.get(e.module)!.push(e);
    }
    // Within each module: sort by primary muscle, then name. If a muscle hint
    // is provided, surface matching exercises first within their module.
    for (const [, arr] of byModule) {
      arr.sort((a, b) => {
        const aHit = primaryMuscleHint
          ? a.primaryMuscles.includes(primaryMuscleHint) ? 0 : 1
          : 0;
        const bHit = primaryMuscleHint
          ? b.primaryMuscles.includes(primaryMuscleHint) ? 0 : 1
          : 0;
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
    const moduleOrder = Array.from(byModule.keys());
    if (primaryMuscleHint) {
      moduleOrder.sort((a, b) => {
        const aHit = byModule
          .get(a)!
          .some((e) => e.primaryMuscles.includes(primaryMuscleHint));
        const bHit = byModule
          .get(b)!
          .some((e) => e.primaryMuscles.includes(primaryMuscleHint));
        if (aHit && !bHit) return -1;
        if (!aHit && bHit) return 1;
        return 0;
      });
    }
    return moduleOrder.map((m) => ({ module: m, exercises: byModule.get(m)! }));
  }, [library, excludeIds, q, primaryMuscleHint]);

  const toggle = (id: string) => {
    if (mode === 'single') {
      onPick?.(id);
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
    if (mode !== 'multi') return;
    if (selected.size === 0) return;
    onPickMany?.(Array.from(selected));
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
      onClick={onCancel}
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
            onClick={onCancel}
            aria-label="Close"
            className="p-1 text-ink-400 hover:text-ink-100"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-ink-800">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search exercises or muscles"
              className="w-full bg-ink-900 border border-ink-700 rounded-md pl-8 pr-3 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-ink-500"
              autoFocus
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
                        className={`w-full text-left px-2 py-1.5 rounded-md border text-sm flex items-center justify-between transition ${
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
              disabled={selected.size === 0}
              className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
            >
              Use {selected.size > 0 ? `${selected.size} ` : ''}exercise
              {selected.size === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
