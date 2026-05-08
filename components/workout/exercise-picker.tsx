'use client';

// Exercise picker — bottom sheet on mobile, centered modal on desktop.
// Search input, exercises grouped by module, and an embedded "add custom" form.

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Trash2, PlayCircle } from 'lucide-react';
import { MUSCLE_GROUPS } from '@/lib/exercises-data';
import type { ExerciseInfo } from './workout-view';

type Props = {
  availableExercises: ExerciseInfo[];
  excludeIds: Set<string>;
  onPick: (exerciseId: string) => void;
  onClose: () => void;
  onCreateCustom: (
    name: string,
    primaryMuscles: string[],
    secondaryMuscles: string[],
    prescription: string | undefined,
    videoUrl: string | undefined,
    restTimerSeconds: number | undefined,
  ) => void;
  onDeleteCustom: (exerciseId: string) => void;
};

export function ExercisePicker({
  availableExercises,
  excludeIds,
  onPick,
  onClose,
  onCreateCustom,
  onDeleteCustom,
}: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'browse' | 'custom'>('browse');

  // ESC closes — matches the confirm dialog behavior and basic modal expectations
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Filter + group. Search matches name OR any muscle (primary or secondary).
  const groupedByModule = useMemo(() => {
    const filtered = availableExercises.filter((e) => {
      if (excludeIds.has(e.id)) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        e.primaryMuscles.some((m) => m.toLowerCase().includes(q)) ||
        e.secondaryMuscles.some((m) => m.toLowerCase().includes(q))
      );
    });
    const groups = new Map<string, ExerciseInfo[]>();
    for (const ex of filtered) {
      if (!groups.has(ex.module)) groups.set(ex.module, []);
      groups.get(ex.module)!.push(ex);
    }
    return groups;
  }, [availableExercises, excludeIds, query]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
    >
      <div
        className="bg-ink-950 border border-ink-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-ink-800 flex items-center justify-between">
          <h2 id="picker-title" className="font-display text-2xl">
            Pick an exercise
          </h2>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-100 transition p-2 -mr-2"
            aria-label="Close picker"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-ink-800 px-5">
          <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>
            Browse
          </TabButton>
          <TabButton active={tab === 'custom'} onClick={() => setTab('custom')}>
            Add custom
          </TabButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'browse' ? (
            <BrowseTab
              query={query}
              setQuery={setQuery}
              groupedByModule={groupedByModule}
              onPick={onPick}
              onDeleteCustom={onDeleteCustom}
            />
          ) : (
            <CustomTab
              onCreate={(name, primary, secondary, prescription, videoUrl, restTimerSeconds) => {
                onCreateCustom(name, primary, secondary, prescription, videoUrl, restTimerSeconds);
                setTab('browse');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ TAB BUTTON ============

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`py-3 px-4 text-xs tracking-[0.2em] uppercase transition ${
        active ? 'accent-text border-b-2 accent-border' : 'text-ink-500 hover:text-ink-300'
      }`}
    >
      {children}
    </button>
  );
}

// ============ BROWSE TAB ============

function BrowseTab({
  query,
  setQuery,
  groupedByModule,
  onPick,
  onDeleteCustom,
}: {
  query: string;
  setQuery: (s: string) => void;
  groupedByModule: Map<string, ExerciseInfo[]>;
  onPick: (id: string) => void;
  onDeleteCustom: (id: string) => void;
}) {
  // Order modules consistently — customs at the end
  const moduleOrder = [
    'Activation Lower',
    'Activation Upper',
    'Mobility Lower',
    'Strength Barbell',
    'Strength Accessory',
    'Balance',
    'Custom',
  ];
  const orderedModules = moduleOrder.filter((m) => groupedByModule.has(m));

  const totalCount = Array.from(groupedByModule.values()).reduce(
    (s, arr) => s + arr.length,
    0,
  );

  return (
    <>
      {/* Search */}
      <div className="px-5 pt-4 pb-2 sticky top-0 bg-ink-950 z-10 border-b border-ink-900">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises or muscles..."
            className="w-full bg-ink-900 border border-ink-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-accent/50"
            autoFocus
          />
        </div>
      </div>

      {/* List */}
      <div className="px-5 py-3">
        {totalCount === 0 ? (
          <div className="text-center py-10 text-sm text-ink-500 italic font-display">
            No exercises match.
          </div>
        ) : (
          orderedModules.map((module) => {
            const exercises = groupedByModule.get(module)!;
            return (
              <div key={module} className="mb-5">
                <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
                  {module}
                </div>
                <div className="space-y-1.5">
                  {exercises.map((ex) => (
                    <div
                      key={ex.id}
                      className="border border-ink-800 hover:border-accent/40 transition rounded-lg flex items-stretch"
                    >
                      <button
                        onClick={() => onPick(ex.id)}
                        className="flex-1 px-3 py-2.5 text-left"
                      >
                        <div className="text-sm text-ink-100 flex items-center gap-1.5">
                          <span>{ex.name}</span>
                          {ex.videoUrl && (
                            <PlayCircle
                              size={11}
                              className="text-ink-500 shrink-0"
                              aria-label="Has demo video"
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {ex.prescription && (
                            <span className="text-[10px] text-ink-500 font-mono">
                              {ex.prescription}
                            </span>
                          )}
                          {ex.primaryMuscles.length > 0 && (
                            <span className="text-[10px] text-ink-500">
                              · {ex.primaryMuscles.slice(0, 3).join(', ')}
                              {ex.primaryMuscles.length > 3 ? '…' : ''}
                            </span>
                          )}
                        </div>
                      </button>
                      {ex.isCustom && (
                        <button
                          onClick={() => onDeleteCustom(ex.id)}
                          className="px-4 text-ink-500 hover:text-bad transition border-l border-ink-800"
                          aria-label={`Delete custom exercise ${ex.name}`}
                          title="Delete custom exercise"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ============ CUSTOM TAB ============

function CustomTab({
  onCreate,
}: {
  onCreate: (
    name: string,
    primaryMuscles: string[],
    secondaryMuscles: string[],
    prescription: string | undefined,
    videoUrl: string | undefined,
    restTimerSeconds: number | undefined,
  ) => void;
}) {
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<string[]>([]);
  const [prescription, setPrescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoError, setVideoError] = useState<string | null>(null);
  // null = use the user's global default. Otherwise an explicit override.
  const [restSeconds, setRestSeconds] = useState<number | null>(null);

  // A muscle can't be both primary and secondary on the same exercise — toggling
  // it into one tier removes it from the other.
  function togglePrimary(id: string) {
    setPrimary((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setSecondary((s) => s.filter((x) => x !== id));
  }
  function toggleSecondary(id: string) {
    setSecondary((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setPrimary((p) => p.filter((x) => x !== id));
  }

  function validateUrl(url: string): string | null {
    if (!url.trim()) return null; // empty is fine — field is optional
    try {
      new URL(url);
      return null;
    } catch {
      return 'Must be a full URL (https://…)';
    }
  }

  function submit() {
    if (!name.trim() || primary.length === 0) return;
    const trimmedUrl = videoUrl.trim();
    const urlError = validateUrl(trimmedUrl);
    if (urlError) {
      setVideoError(urlError);
      return;
    }
    onCreate(
      name.trim(),
      primary,
      secondary,
      prescription.trim() || undefined,
      trimmedUrl || undefined,
      restSeconds ?? undefined,
    );
    setName('');
    setPrimary([]);
    setSecondary([]);
    setPrescription('');
    setVideoUrl('');
    setVideoError(null);
    setRestSeconds(null);
  }

  const canSubmit = name.trim().length > 0 && primary.length > 0;

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-ink-500 italic font-display mb-4">
        Add bench press, OHP, curls, anything that&apos;s not in the built-in list.
      </p>

      {/* Name */}
      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Bench press"
        className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-accent/50"
      />

      {/* Default scheme */}
      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Default scheme <span className="text-ink-600">(optional)</span>
      </label>
      <input
        type="text"
        value={prescription}
        onChange={(e) => setPrescription(e.target.value)}
        placeholder="e.g. 4×8"
        className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-accent/50"
      />

      {/* Video URL */}
      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Demo video URL <span className="text-ink-600">(optional)</span>
      </label>
      <input
        type="url"
        value={videoUrl}
        onChange={(e) => {
          setVideoUrl(e.target.value);
          if (videoError) setVideoError(null);
        }}
        placeholder="https://youtube.com/watch?v=…"
        className="w-full bg-ink-900 border border-ink-800 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:border-accent/50"
      />
      {videoError ? (
        <p className="text-[10px] text-bad mb-3">{videoError}</p>
      ) : (
        <div className="mb-4" />
      )}

      {/* Primary muscles */}
      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Primary muscles <span className="accent-text">*</span>
      </label>
      <p className="text-[10px] text-ink-500 italic font-display mb-2">
        What this exercise is built around. Each set counts fully toward these.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MUSCLE_GROUPS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => togglePrimary(m.id)}
            className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
              primary.includes(m.id)
                ? 'accent-bg text-ink-950 border-transparent'
                : 'border-ink-800 text-ink-300 hover:border-ink-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Secondary muscles */}
      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Secondary muscles <span className="text-ink-600">(optional)</span>
      </label>
      <p className="text-[10px] text-ink-500 italic font-display mb-2">
        Worked but not the focus. Each set counts as half.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {MUSCLE_GROUPS.map((m) => {
          const isPrimary = primary.includes(m.id);
          const isSecondary = secondary.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleSecondary(m.id)}
              disabled={isPrimary}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                isSecondary
                  ? 'bg-ink-300 text-ink-950 border-transparent'
                  : isPrimary
                    ? 'border-ink-900 text-ink-700 cursor-not-allowed'
                    : 'border-ink-800 text-ink-300 hover:border-ink-600'
              }`}
              title={isPrimary ? 'Already a primary muscle' : undefined}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Rest timer override */}
      <label className="text-[10px] tracking-[0.25em] uppercase text-ink-400 block mb-1.5">
        Default rest <span className="text-ink-600">(optional)</span>
      </label>
      <p className="text-[10px] text-ink-500 italic font-display mb-2">
        Tap a duration to override just for this exercise. Leave blank to use your global setting.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          type="button"
          onClick={() => setRestSeconds(null)}
          className={`text-xs px-2.5 py-1 rounded-full border transition ${
            restSeconds === null
              ? 'accent-bg text-ink-950 border-transparent'
              : 'border-ink-800 text-ink-300 hover:border-ink-600'
          }`}
        >
          Use global
        </button>
        {[30, 60, 90, 120, 180, 240].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setRestSeconds(s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              restSeconds === s
                ? 'accent-bg text-ink-950 border-transparent'
                : 'border-ink-800 text-ink-300 hover:border-ink-600'
            }`}
          >
            {s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}m` : `${(s / 60).toFixed(1)}m`}
          </button>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full accent-bg text-ink-950 py-3 rounded-lg font-semibold tracking-wide disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition"
      >
        Add to my list
      </button>
    </div>
  );
}
