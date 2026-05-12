'use client';

// Inline "more info" popover used to surface domain context the user would
// otherwise have to google — RPE, volume tiers, recency thresholds, etc.
// Click/tap to open, click outside or Esc to close. Keyboard-accessible
// (Tab to focus, Enter/Space to open). Built on Radix Popover so touch and
// pointer behave identically across desktop, mobile web, and PWA — the
// hover-only HTML `title` attribute silently fails on touch, which is why
// we don't use it for substantive copy.
//
// Two visual variants:
//   - 'icon' (default): renders a small ⓘ next to whatever it's near.
//   - 'underline': wraps inline text with a dotted underline (Wikipedia
//     style). Use this when the trigger lives inside running prose.

import * as Popover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

type InfoTooltipProps = {
  /** Short label naming the concept. Surfaces as the popover's title and the trigger's aria-label. */
  label: string;
  /** Rich explanation — can include paragraphs, lists, inline emphasis. */
  children: ReactNode;
  /** 'icon' renders a small ⓘ; 'underline' wraps `trigger` with a dotted underline. */
  variant?: 'icon' | 'underline';
  /** Inline text to wrap when variant='underline'. */
  trigger?: ReactNode;
  /** Icon size in px. Defaults to 12 (matches the surrounding label text). */
  size?: number;
  /** Preferred placement; Radix flips automatically if it doesn't fit. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Extra classes on the trigger. */
  className?: string;
};

export function InfoTooltip({
  label,
  children,
  variant = 'icon',
  trigger,
  size = 12,
  side = 'top',
  align = 'center',
  className = '',
}: InfoTooltipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {variant === 'underline' && trigger !== undefined ? (
          <button
            type="button"
            aria-label={`More info: ${label}`}
            className={`inline underline decoration-dotted decoration-ink-500 underline-offset-[3px] hover:decoration-ink-200 hover:text-ink-100 transition cursor-help focus:outline-none focus-visible:decoration-accent ${className}`}
          >
            {trigger}
          </button>
        ) : (
          <button
            type="button"
            aria-label={`More info: ${label}`}
            // -m offsets give a generous tap target without bloating layout —
            // the visible icon stays small but the hit area is ~24px on touch.
            className={`inline-flex items-center justify-center text-ink-500 hover:text-ink-200 transition align-middle -m-1 p-1 rounded-full focus:outline-none focus-visible:text-ink-100 focus-visible:ring-1 focus-visible:ring-accent/60 ${className}`}
          >
            <Info size={size} aria-hidden="true" strokeWidth={2} />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          avoidCollisions
          className="z-50 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-[12px] leading-relaxed text-ink-200 shadow-xl shadow-black/50 outline-none"
        >
          <div className="text-[10px] tracking-[0.2em] uppercase text-ink-500 mb-1">{label}</div>
          <div className="space-y-1.5 [&_strong]:text-ink-100 [&_strong]:font-medium [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 [&_a]:text-ink-100 hover:[&_a]:text-accent [&_p]:leading-relaxed">
            {children}
          </div>
          <Popover.Arrow className="fill-ink-700" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
