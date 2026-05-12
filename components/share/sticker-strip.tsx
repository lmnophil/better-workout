'use client';

// Quick-suggestion stickers — directional cues with no required numbers. The
// reviewer taps to send; the owner fills in the actual value when they
// accept. Designed for low cognitive load: 5 (reps) or 4 (time) buttons in a
// single tap-through row.

import { useTransition } from 'react';
import { postShareSuggestion } from '@/lib/actions';

const REPS_STICKERS = [
  { key: 'more_sets', label: '+ sets' },
  { key: 'fewer_sets', label: '− sets' },
  { key: 'more_reps', label: '+ reps' },
  { key: 'fewer_reps', label: '− reps' },
  { key: 'more_weight', label: '+ weight' },
  { key: 'less_weight', label: '− weight' },
  { key: 'bodyweight', label: 'bodyweight' },
] as const;

const TIME_STICKERS = [
  { key: 'more_sets', label: '+ sets' },
  { key: 'fewer_sets', label: '− sets' },
] as const;

type StickerKey =
  | 'more_sets'
  | 'fewer_sets'
  | 'more_reps'
  | 'fewer_reps'
  | 'more_weight'
  | 'less_weight'
  | 'bodyweight';

export function StickerStrip({
  token,
  targetType,
  targetId,
  metric,
}: {
  token: string;
  targetType: 'template_exercise' | 'routine_day' | 'routine';
  targetId: string;
  metric: 'reps' | 'time';
}) {
  const [pending, startTransition] = useTransition();
  const stickers = metric === 'time' ? TIME_STICKERS : REPS_STICKERS;

  const send = (sticker: StickerKey) => {
    startTransition(async () => {
      try {
        await postShareSuggestion({
          token,
          targetType,
          targetId,
          payload: { kind: 'sticker', sticker } as never,
        });
      } catch {
        /* silent */
      }
    });
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {stickers.map((s) => (
        <button
          key={s.key}
          type="button"
          disabled={pending}
          onClick={() => send(s.key)}
          className="px-1.5 py-0.5 text-[10px] rounded-md border border-ink-700 text-ink-400 hover:text-ink-100 hover:border-ink-500 disabled:opacity-50"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
