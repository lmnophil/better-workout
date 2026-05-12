'use client';

// Tells the service worker to drop user-scoped caches (page HTML, RSC
// payloads, API responses) when the user lands on /signin after explicit
// signout or the stale-cookie recovery flow.
//
// Why: with NetworkFirst caching, a transient network failure on the next
// sign-in could serve the prior user's cached HTML from the SW. Static
// assets stay cached because they're identical across users.
//
// We render this on /signin only when a `cleanup` flag is present in the
// URL — set by `app/api/auth/recover` and the signout server action — so
// arriving at /signin organically (bookmark, direct nav) doesn't trigger a
// pointless cache wipe.

import { useEffect } from 'react';

export function SwSignoutCleanup({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    // Try the controller (current SW serving this page). Fall back to the
    // registration's active worker for the case where the SW exists but
    // hasn't claimed this client yet (first navigation after install).
    const ctrl = navigator.serviceWorker.controller;
    if (ctrl) {
      ctrl.postMessage({ type: 'CLEAR_USER_CACHES' });
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        reg?.active?.postMessage({ type: 'CLEAR_USER_CACHES' });
      })
      .catch(() => {
        // No SW (dev, unsupported browser). Nothing to clear.
      });
  }, [active]);
  return null;
}
