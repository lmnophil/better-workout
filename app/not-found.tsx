// Root 404. Renders for any unmatched URL and for `notFound()` calls that
// aren't caught by a more specific not-found.tsx (e.g. /routine/shares/[shareId]).
// Without this, Next serves its unstyled default 404, which reads as broken
// against the app's dark theme. Mirrors the visual language of app/error.tsx.

import Link from 'next/link';

export const metadata = { title: 'Not found — Workout Tracker' };

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10 bg-ink-950 text-ink-100">
      <div className="max-w-sm text-center">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">Not found</div>
        <h1
          className="font-display text-3xl tracking-tight mb-3"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          Nothing here.
        </h1>
        <p className="text-sm text-ink-300 leading-relaxed mb-6">
          This page doesn&apos;t exist — the link may be old, or the address off by a character.
        </p>
        <Link
          href="/"
          className="accent-bg text-ink-950 px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition inline-flex items-center gap-2"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
