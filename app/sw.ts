/// <reference lib="webworker" />
// Service worker source. Compiled by Serwist into public/sw.js at build time.
//
// Strategy:
//   - Static assets (JS, CSS, fonts, images): cached aggressively
//   - Page navigations: network-first, fall back to cache, fall back to /offline
//   - Server actions / API routes: never cached (always network)
//
// We use Serwist's defaultCache as the baseline — it's a sensible Next.js-tuned
// preset that handles the above. We just add the offline fallback.
//
// We deliberately *do not* `skipWaiting` on install: a silent mid-workout swap
// can put the running page out of sync with newly-cached chunks (the classic
// SW "version skew"). Instead the new SW parks in `waiting` and the client
// shows a prompt — see components/ui/sw-update-prompt.tsx. The handler below
// lets the client tell us when the user has accepted the reload.

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Cache-name patterns that hold user-scoped HTML / RSC payloads / API JSON.
// On signout we want these gone so a second user on the same device can't
// land on a stale cached page during a network blip. Static-asset caches
// (`static-*`, `images`, `google-fonts*`, etc.) are user-agnostic and we
// keep them — they amortise cost across sign-ins.
const USER_SCOPED_CACHE_RE = /pages|rsc|apis|cross-origin|others/;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // skipWaiting / clientsClaim left false on purpose; see the doc comment
  // above. Updates go through the SKIP_WAITING message below.
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();

// Client → SW commands.
//
// SKIP_WAITING — user accepted the update-available prompt. Activate now;
// the client follows up with a reload once `controllerchange` fires.
//
// CLEAR_USER_CACHES — sign-out / auth-recovery fired. Drop only the caches
// that hold user-scoped data, so we don't blow away fonts and JS chunks
// that the next sign-in (or the same user signing back in) would refetch
// anyway.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (!data?.type) return;

  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }

  if (data.type === 'CLEAR_USER_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => USER_SCOPED_CACHE_RE.test(k))
            .map((k) => caches.delete(k)),
        ),
      ),
    );
  }
});
