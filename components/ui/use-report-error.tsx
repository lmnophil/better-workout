'use client';

// Shared hook for shipping errors caught by error.tsx boundaries to the
// server-side log sink. Used by every error.tsx (root, route group, etc.)
// so client crashes land alongside server errors in the same JSON stream.
//
// Fire-and-forget: we never block the user's recovery on a network call, and
// we silently swallow shipping failures (the boundary's UI already gives the
// user a way out).

import { useEffect } from 'react';

type Kind = 'route' | 'global';

export function useReportError(error: Error & { digest?: string }, kind: Kind = 'route') {
  useEffect(() => {
    void fetch('/api/log/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
    // Mirror to console for dev — Next.js dev overlay also already shows it.
    console.error(`${kind === 'global' ? 'Root layout' : 'App'} error:`, error);
  }, [error, kind]);
}
