'use client';

// Service-worker update prompt.
//
// Background: `app/sw.ts` no longer self-activates new versions. When a new
// SW finishes installing it parks in the `waiting` state, with the previous
// SW still serving fetches. This component watches for that, asks the user,
// and on confirmation tells the new SW to skipWaiting + reloads the page so
// the running JS and the SW-served assets are guaranteed to match.
//
// Why a prompt instead of auto-reload: mid-workout silent reloads are
// disruptive (the user may be typing in a set's reps/weight, which commits
// on blur — a reload kills the in-flight value). Letting the user pick the
// moment also follows the standard PWA "controlled update" pattern.
//
// We tolerate a controller-less first load (no SW installed yet) and the
// missing-API case (browsers without service workers, dev mode where the
// SW is disabled). All entry points are best-effort.

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

export function SwUpdatePrompt() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let cancelled = false;

    navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (cancelled || !registration) return;

        // A worker is already waiting — installed during a prior page load.
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }

        // A new version showed up while this page is open.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // Only surface the prompt when there's an existing controller —
            // first-ever install isn't an "update."
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
            }
          });
        });
      })
      .catch(() => {
        // No SW registered (dev mode, unsupported browser). Nothing to do.
      });

    // When the controller actually swaps, the matching tab reloads itself
    // (see acceptUpdate below). This catches the case where another tab
    // triggered the swap on our behalf — keep this tab in sync too.
    const onControllerChange = () => {
      if (cancelled) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  function acceptUpdate() {
    if (!waitingWorker) return;
    // Tell the waiting SW to activate. The `controllerchange` listener above
    // handles the reload once the activation finishes, so we don't reload
    // here and race the activation.
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    setWaitingWorker(null);
  }

  function dismiss() {
    // User isn't ready yet — clearing the local state hides the prompt for
    // this session. The SW stays in `waiting`; the next page load (or the
    // next `updatefound` event) re-surfaces it.
    setWaitingWorker(null);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[68px] sm:bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-ink-900 border accent-border rounded-lg shadow-lg px-3 py-2.5 flex items-center gap-3"
    >
      <RefreshCw size={14} className="accent-text shrink-0" />
      <div className="flex-1 min-w-0 text-xs text-ink-200 leading-snug">
        A new version of the app is ready.
      </div>
      <button
        type="button"
        onClick={acceptUpdate}
        className="text-[11px] tracking-wider uppercase accent-bg text-ink-950 px-2.5 py-1 rounded font-semibold hover:brightness-110 transition shrink-0"
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update prompt"
        className="text-ink-500 hover:text-ink-100 transition shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
