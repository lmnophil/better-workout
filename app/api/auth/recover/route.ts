// Stale-session escape hatch. Hit when the (app) layout's `auth()` returns
// null despite a session cookie being present — almost always because a
// `prisma migrate reset` wiped the User row the JWT points at. The JWT
// callback in auth.ts already returned null on the user-missing check; this
// route does what that callback can't from its position: clear the cookie on
// the response so the next request lands cleanly on /signin instead of
// re-entering the same loop. Returning null from the JWT callback marks the
// session unauthenticated for that single request but leaves the cookie in
// place, so middleware (which uses the Edge-safe config and can't hit the DB)
// keeps seeing the stale token as valid until something explicitly clears it.
//
// Lives under /api/auth/* so it's already excluded from the middleware
// matcher — no `PUBLIC_PATHS` change needed.

import { NextResponse } from 'next/server';

const SESSION_COOKIE_CANDIDATES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
];

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL('/signin', request.url);
  // Signal the signin page to ask the service worker to drop user-scoped
  // caches (page HTML, RSC payloads, API JSON). Static assets stay so the
  // next sign-in doesn't pay a cold cache. See
  // components/auth/sw-signout-cleanup.tsx and the message handler in
  // app/sw.ts.
  url.searchParams.set('cleanup', '1');
  const response = NextResponse.redirect(url);
  // Delete every variant — both the dev cookie and the secure prod cookie name —
  // so this works the same whether the operator is on HTTP localhost or HTTPS.
  for (const name of SESSION_COOKIE_CANDIDATES) {
    response.cookies.delete(name);
  }
  // Don't let any cache (PWA service worker, browser bfcache, intermediate
  // proxy) keep this response: it's the one response that's explicitly
  // clearing a stale auth cookie, and a cached copy would keep stripping
  // valid cookies on later visits.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
