'use client';

// Root error boundary. Catches unhandled errors in any route that isn't covered
// by a more specific error.tsx. Server action throws, render errors, etc. all
// land here.

import { RotateCw } from 'lucide-react';
import { useReportError } from '@/components/ui/use-report-error';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportError(error, 'route');

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10 bg-ink-950 text-ink-100">
      <div className="max-w-sm text-center">
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
          Something went wrong
        </div>
        <h1
          className="font-display text-3xl tracking-tight mb-3"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
        >
          Hmm.
        </h1>
        <p className="text-sm text-ink-300 leading-relaxed mb-6">
          The app hit an unexpected error. Your data is safe — try again, or head home.
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono text-ink-600 mb-4">ref: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="accent-bg text-ink-950 px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition inline-flex items-center gap-2"
          >
            <RotateCw size={14} strokeWidth={2.5} />
            Try again
          </button>
          {/* Plain <a> on purpose — error boundary wants a hard reload to
              reset any broken Next.js client state. next/link would keep the
              corrupted runtime alive. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="text-xs tracking-wider uppercase text-ink-400 hover:text-ink-100 transition"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
