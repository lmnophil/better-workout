// Offline fallback. Shown by the service worker when a navigation request
// can't be served from network or cache. Kept deliberately spartan.

import { OfflineAutoReload } from './auto-reload';

export const metadata = { title: 'Offline — Workout Tracker' };

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10 bg-ink-950 text-ink-100">
      <div className="max-w-sm text-center">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">Offline</div>
        <h1
          className="font-display text-3xl tracking-tight mb-3"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          You&apos;re offline
        </h1>
        <p className="text-sm text-ink-300 leading-relaxed mb-6">
          You can still browse cached pages from earlier sessions. New workout data will sync when
          you&apos;re back online.
        </p>
        {/* Plain <a> on purpose — this page is the offline fallback, served
            by the service worker when the Next router may not be available. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="text-xs tracking-[0.2em] uppercase accent-text underline underline-offset-4 hover:no-underline"
        >
          Try again
        </a>
        <OfflineAutoReload />
      </div>
    </div>
  );
}
