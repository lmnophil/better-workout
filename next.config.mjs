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
  // Server Actions get CSRF protection from Next's built-in check: the request's
  // Origin host must equal the forwarded host (X-Forwarded-Host, falling back to
  // Host). We deliberately do NOT set experimental.serverActions.allowedOrigins:
  //
  //   - The old ['localhost:3000'] value was inert. allowedOrigins is matched
  //     against the browser Origin (the public host), never against the upstream
  //     Host — so a localhost entry could never match a real request and did
  //     nothing either way.
  //   - It can't be driven from AUTH_URL at runtime either. `output: 'standalone'`
  //     freezes this config into the build (.next/required-server-files.json,
  //     re-read at boot via __NEXT_PRIVATE_STANDALONE_CONFIG), and the Docker
  //     image is built with no AUTH_URL present — so any process.env read here
  //     would bake an empty value into the image for good.
  //
  // The operator requirement is therefore on the proxy, not this file: it must
  // forward the real host. Caddy sets X-Forwarded-Host automatically; nginx needs
  // `proxy_set_header X-Forwarded-Host $host`. See DEPLOY.md.
};

export default withSerwist(nextConfig);
