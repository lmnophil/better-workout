'use client';

// Error boundary for the (auth) route group. If something explodes during
// sign-in or magic-link verification, this catches it and gives a path forward.

import { useReportError } from '@/components/ui/use-report-error';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportError(error, 'route');

  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-ink-500 mb-2">
        Workout Tracker
      </div>
      <h1
        className="font-display text-3xl tracking-tight mb-3"
        style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 30" }}
      >
        Sign-in failed
      </h1>
      <p className="text-sm text-ink-300 leading-relaxed mb-6">
        Something went wrong with the sign-in flow. Try again, or use the other method.
      </p>
      <button
        onClick={reset}
        className="w-full accent-bg text-ink-950 py-3 rounded-lg font-semibold tracking-wide hover:brightness-110 transition"
      >
        Try again
      </button>
      <a
        href="/signin"
        className="block text-center mt-4 text-xs tracking-wider uppercase text-ink-400 hover:text-ink-100 transition"
      >
        Back to sign in
      </a>
    </div>
  );
}
