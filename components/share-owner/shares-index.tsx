'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Copy, Check, Trash2 } from 'lucide-react';
import { mintRoutineShare, revokeRoutineShare } from '@/lib/actions';

type Share = {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
  counts: {
    reviewers: number;
    comments: number;
    suggestions: number;
    reactions: number;
  };
};

export function SharesIndex({ shares, baseUrl }: { shares: Share[]; baseUrl: string }) {
  const [label, setLabel] = useState('');
  const [pending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [justMintedCopied, setJustMintedCopied] = useState(false);

  const mint = () => {
    startTransition(async () => {
      try {
        const result = await mintRoutineShare({ label: label.trim() || undefined });
        setLabel('');
        // Optimistically copy the new URL so the user doesn't have to hunt
        // for the row that just appeared and tap the per-row copy button.
        // Clipboard writes after an await can fail silently in some browsers
        // when they decide the user gesture has ended; the explicit per-row
        // button remains as the manual fallback.
        if (result?.token) {
          const url = `${baseUrl}/share/${result.token}`;
          try {
            await navigator.clipboard.writeText(url);
            setJustMintedCopied(true);
            setTimeout(() => setJustMintedCopied(false), 2000);
          } catch {
            /* silent — user can use the per-row copy button */
          }
        }
      } catch {
        /* silent */
      }
    });
  };

  const revoke = (shareId: string) => {
    if (!confirm('Revoke this share link? Anyone with the URL will lose access.')) return;
    startTransition(async () => {
      try {
        await revokeRoutineShare({ shareId });
      } catch {
        /* silent */
      }
    });
  };

  const copy = (token: string, id: string) => {
    const url = `${baseUrl}/share/${token}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
  };

  const active = shares.filter((s) => !s.revokedAt);
  const revoked = shares.filter((s) => s.revokedAt);

  return (
    <div>
      <div className="bg-ink-900/40 border border-ink-800 rounded-lg p-3 mb-4">
        <div className="text-sm text-ink-200 mb-2">Mint a new share link</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') mint();
            }}
            placeholder="optional label (e.g. 'Alex review')"
            maxLength={60}
            className="flex-1 bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100"
          />
          <button
            type="button"
            disabled={pending}
            onClick={mint}
            className="px-3 py-1.5 bg-amber-400/90 hover:bg-amber-400 text-ink-950 font-medium rounded-md text-sm disabled:opacity-40"
          >
            Mint link
          </button>
        </div>
        <p className="text-xs text-ink-400 mt-2">
          Anyone with the URL can view your routine and comment. Revoke any time.
        </p>
        {justMintedCopied && (
          <p className="text-xs accent-text mt-1 inline-flex items-center gap-1">
            <Check size={12} /> link copied to clipboard
          </p>
        )}
      </div>

      {active.length > 0 && (
        <ul className="space-y-2 mb-6">
          {active.map((s) => (
            <li key={s.id} className="bg-ink-900/40 border border-ink-800 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/routine/shares/${s.id}`}
                    className="font-medium text-ink-100 hover:underline"
                  >
                    {s.label ?? 'Share link'}
                  </Link>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    {s.counts.reviewers} reviewer{s.counts.reviewers === 1 ? '' : 's'} ·{' '}
                    {s.counts.comments} unresolved comment
                    {s.counts.comments === 1 ? '' : 's'} · {s.counts.suggestions} open suggestion
                    {s.counts.suggestions === 1 ? '' : 's'} · {s.counts.reactions} 👍
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => copy(s.token, s.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 border border-ink-700 rounded-md text-xs text-ink-300 hover:text-ink-100"
                    aria-label="Copy share URL"
                  >
                    {copiedId === s.id ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === s.id ? 'copied' : 'copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => revoke(s.id)}
                    disabled={pending}
                    aria-label="Revoke"
                    className="p-1.5 text-ink-400 hover:text-rose-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="text-[11px] text-ink-500 mt-2 break-all">
                {baseUrl}/share/{s.token}
              </div>
            </li>
          ))}
        </ul>
      )}

      {active.length === 0 && <p className="text-ink-400 text-sm">No active share links yet.</p>}

      {revoked.length > 0 && (
        <details className="mt-6">
          <summary className="text-xs text-ink-400 cursor-pointer hover:text-ink-200">
            Revoked links ({revoked.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {revoked.map((s) => (
              <li key={s.id} className="text-xs text-ink-500">
                {s.label ?? 'Share link'} — revoked{' '}
                {new Date(s.revokedAt as string).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
