'use client';

// Tiny client island for the offline page. Watches for the network coming
// back and reloads to the user's original destination so they don't have to
// notice the fallback resolved and tap "Try again" themselves.
//
// Why a separate file: keeping the surrounding page a server component lets
// it stay statically rendered and precached by the service worker, which is
// how the fallback gets served in the first place.

import { useEffect } from 'react';

export function OfflineAutoReload() {
  useEffect(() => {
    // Already back online by the time the fallback rendered (e.g. flap during
    // navigation). Reload immediately rather than waiting for a state change
    // that may never come.
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      window.location.reload();
      return;
    }
    const onOnline = () => window.location.reload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
  return null;
}
