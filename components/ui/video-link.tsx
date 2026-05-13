'use client';

// Small anchor that opens a demo video in a new tab. Shared between the
// exercise picker, active workout, routine editor, routine timeline, and
// public share view so the icon, hit area, accessibility label, and click
// stopPropagation behaviour all agree.
//
// Always stops propagation: every place this icon appears, it lives inside
// a clickable row (toggle selection, expand day, etc.). Without stopProp,
// tapping the icon would fire the parent's onClick before the link
// navigates, which is at best surprising and at worst (in the picker)
// silently fails because the parent was a real <button>.

import { PlayCircle } from 'lucide-react';

type Props = {
  url: string | null | undefined;
  exerciseName: string;
  size?: number;
  className?: string;
};

export function VideoLink({ url, exerciseName, size = 13, className = '' }: Props) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={`inline-flex items-center justify-center text-ink-500 hover:accent-text transition shrink-0 -m-1 p-1 rounded ${className}`}
      aria-label={`Watch ${exerciseName} demonstration`}
      title="Watch demo"
    >
      <PlayCircle size={size} aria-hidden="true" />
    </a>
  );
}
