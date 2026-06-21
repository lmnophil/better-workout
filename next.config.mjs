import withSerwistInit from '@serwist/next';

// Serwist's offline fallback (app/sw.ts) resolves via `matchPrecache('/offline')`,
// which only returns a response if `/offline` is in the precache manifest. The
// `@serwist/next` build only precaches `_next/static/*` and `public/*` — it never
// precaches rendered routes — so the fallback has to be injected here explicitly.
//
// The revision busts the precached copy per build. `/offline` is a rendered route:
// its HTML embeds this build's hashed CSS/JS URLs, and Serwist evicts precache
// entries that drop out of the manifest on activate. A constant revision would
// pin a stale offline page pointing at chunks the new build already removed, so it
// would render unstyled when actually served offline. A fresh value per build keeps
// the fallback in lockstep with the static precache; the cost is one small HTML
// re-fetch on each SW update, which already happens whenever the manifest changes.
const OFFLINE_REVISION = String(Date.now());

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Don't generate the service worker in dev — it caches too aggressively
  // and makes hot reload annoying.
  disable: process.env.NODE_ENV === 'development',
  additionalPrecacheEntries: [{ url: '/offline', revision: OFFLINE_REVISION }],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output produces a minimal Docker image
  output: 'standalone',
  // Reactivate strict mode for catching issues in dev
  reactStrictMode: true,
  experimental: {
    // Server actions are stable in Next 15 but we declare allowed origins
    // for production CSRF protection. Update with your real domain.
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
};

export default withSerwist(nextConfig);
