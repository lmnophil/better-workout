'use client';

// Error boundary for the (app) route group — covers all authenticated routes.
// Only *unexpected* errors land here: expected failures travel as
// { ok: false, error } action results (see lib/action-result.ts), and an
// expired session redirects to /signin from requireUser. So there's nothing
// useful to tell the user beyond "something broke, try again".

import { RotateCw } from 'lucide-react';
import { useReportError } from '@/components/ui/use-report-error';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportError(error, 'route');

  return (
    <div className="px-5 py-12 max-w-md mx-auto text-center">
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
        The app hit an unexpected error. Your last few actions may not have saved — try again.
      </p>
      {error.digest && (
        <p className="text-[10px] font-mono text-ink-600 mb-4">ref: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="accent-bg text-ink-950 px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide hover:brightness-110 transition inline-flex items-center gap-2"
      >
        <RotateCw size={14} strokeWidth={2.5} />
        Try again
      </button>
    </div>
  );
}
