'use client';

// Global error boundary — catches errors thrown by the root layout itself
// (very rare, but it's the only thing error.tsx can't catch since it's
// rendered *inside* the layout).
//
// Must render its own <html> and <body> since the root layout failed.

import { useReportError } from '@/components/ui/use-report-error';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportError(error, 'global');

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#16110d',
          color: '#f3ecdc',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '24rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>
            Something went very wrong.
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#9a9088', marginBottom: '1.5rem' }}>
            The app failed to start. Try refreshing the page.
          </p>
          <button
            onClick={() => location.reload()}
            style={{
              background: '#d4ff3b',
              color: '#16110d',
              border: 'none',
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </body>
    </html>
  );
}
