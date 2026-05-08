// Service worker source. Compiled by Serwist into public/sw.js at build time.
//
// Strategy:
//   - Static assets (JS, CSS, fonts, images): cached aggressively
//   - Page navigations: network-first, fall back to cache, fall back to /offline
//   - Server actions / API routes: never cached (always network)
//
// We use Serwist's defaultCache as the baseline — it's a sensible Next.js-tuned
// preset that handles the above. We just add the offline fallback.

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
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
