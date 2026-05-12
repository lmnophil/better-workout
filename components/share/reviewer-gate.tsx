'use client';

// First-visit screen: collect a display name before letting the reviewer post
// anything. The action sets the per-share reviewer cookie so subsequent visits
// skip this screen until cookies are cleared.

import { useState, useTransition } from 'react';
import { registerShareReviewer } from '@/lib/actions';

type Props = {
  token: string;
  ownerName: string;
  routineName: string;
};

export function ReviewerGate({ token, ownerName, routineName }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Pick a name so the owner knows who said what.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await registerShareReviewer({ token, displayName: trimmed });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not register.');
      }
    });
  };

  return (
    <div className="max-w-md w-full">
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
        Routine review
      </div>
      <h1 className="font-display text-3xl mb-1">
        <span className="accent-text">{ownerName}</span> shared a routine
      </h1>
      <p className="text-ink-300 mb-6">
        Take a look at <span className="text-ink-100">{routineName}</span>, leave comments, suggest
        swaps, or react to exercises you like. Pick a name to get started — the owner will see this
        on every comment you post.
      </p>

      <label className="block text-sm text-ink-300 mb-1">Your display name</label>
      <input
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        maxLength={40}
        autoFocus
        placeholder="e.g. Alex"
        className="w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-ink-100 focus:outline-none focus:border-ink-500"
      />
      {error && <p className="text-rose-400 text-xs mt-2">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-4 w-full bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md py-2 disabled:opacity-50"
      >
        {pending ? 'Joining…' : 'Start reviewing'}
      </button>

      <p className="text-xs text-ink-500 mt-4">
        Your name is local to this share link — clearing browser cookies will ask again. No account
        required.
      </p>
    </div>
  );
}
