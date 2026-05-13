'use client';

// Editor for the user's resistance bands. Bands surface as the load picker
// for exercises with Exercise.loadType='band' (banded glute bridges, lateral
// band walks, etc.). The default trio (Light/Medium/Heavy) is lazily seeded
// the first time getUserBands runs, so most users will land here with three
// rows already populated; the editor lets them rename to match what they
// own ("orange", "red"), reorder by tension, and add or remove rows.
//
// Mirrors the volume-targets / hidden-templates editor style — terse rows,
// inline rename on blur, ChevronUp/Down for reordering, Trash to delete.

import { useState, useTransition } from 'react';
import { ChevronUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { createBand, renameBand, deleteBand, reorderBand } from '@/lib/actions';

type Band = { id: string; name: string; position: number };

export function BandsEditor({ bands }: { bands: Band[] }) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState('');

  const add = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await createBand({ name: trimmed });
        setNewName('');
      } catch {
        /* surfaced via revalidation */
      }
    });
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {bands.map((b, i) => (
          <li
            key={b.id}
            className="bg-ink-900/40 border border-ink-800 rounded-lg px-3 py-2 flex items-center gap-2"
          >
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                onClick={() =>
                  startTransition(() => {
                    reorderBand({ bandId: b.id, direction: 'up' }).catch(() => {});
                  })
                }
                disabled={isPending || i === 0}
                className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label={`Move ${b.name} up`}
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() =>
                  startTransition(() => {
                    reorderBand({ bandId: b.id, direction: 'down' }).catch(() => {});
                  })
                }
                disabled={isPending || i === bands.length - 1}
                className="text-ink-500 hover:text-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                aria-label={`Move ${b.name} down`}
              >
                <ChevronDown size={12} />
              </button>
            </div>
            <BandNameInput band={b} disabled={isPending} />
            <button
              onClick={() =>
                startTransition(() => {
                  deleteBand({ bandId: b.id }).catch(() => {});
                })
              }
              disabled={isPending}
              aria-label={`Delete ${b.name}`}
              className="text-ink-500 hover:text-bad transition disabled:opacity-50 shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {bands.length === 0 && (
          <li className="text-[11px] text-ink-500 italic font-display">
            No bands yet. Add Light/Medium/Heavy or whatever you actually own.
          </li>
        )}
      </ul>
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="Add a band (e.g. orange, light, 30lb)"
          maxLength={40}
          className="flex-1 bg-ink-900 border border-ink-700 rounded-md px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-accent/50"
        />
        <button
          type="button"
          onClick={add}
          disabled={isPending || newName.trim().length === 0}
          className="px-3 py-1.5 text-sm border border-ink-700 hover:border-accent/50 rounded-md text-ink-200 hover:text-ink-100 disabled:opacity-40 transition inline-flex items-center gap-1"
        >
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

function BandNameInput({ band, disabled }: { band: Band; disabled: boolean }) {
  const [text, setText] = useState(band.name);
  const [pending, startTransition] = useTransition();

  function commit() {
    const trimmed = text.trim();
    if (!trimmed || trimmed === band.name) {
      setText(band.name);
      return;
    }
    startTransition(async () => {
      try {
        await renameBand({ bandId: band.id, name: trimmed });
      } catch {
        setText(band.name);
      }
    });
  }

  return (
    <input
      type="text"
      value={text}
      disabled={disabled || pending}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(band.name);
          e.currentTarget.blur();
        }
      }}
      maxLength={40}
      className="flex-1 min-w-0 bg-transparent border-0 text-sm text-ink-100 focus:outline-none focus:border-accent/50 px-1"
      aria-label={`Rename ${band.name}`}
    />
  );
}
