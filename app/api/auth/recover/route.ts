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

import { NextResponse, type NextRequest } from 'next/server';

// Auth.js names the session cookie `authjs.session-token` on HTTP and
// `__Secure-authjs.session-token` on HTTPS, and splits oversized JWTs into
// numbered chunks (`…session-token.0`, `.1`, …). Match any of those so we clear
// whatever the deployment actually set, chunk count included.
const SESSION_COOKIE_RE = /^(__Secure-|__Host-)?authjs\.session-token(\.\d+)?$/;

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const url = new URL('/signin', request.url);
  // Signal the signin page to ask the service worker to drop user-scoped
  // caches (page HTML, RSC payloads, API JSON). Static assets stay so the
  // next sign-in doesn't pay a cold cache. See
  // components/auth/sw-signout-cleanup.tsx and the message handler in
  // app/sw.ts.
  url.searchParams.set('cleanup', '1');
  const response = NextResponse.redirect(url);

  // Expire every session cookie the request actually carries. Reading from the
  // request (rather than blindly deleting a fixed name list) handles the chunked
  // variants precisely and works the same on HTTP localhost or HTTPS prod.
  //
  // The Secure attribute is the load-bearing detail: a browser REJECTS any
  // Set-Cookie for a `__Secure-`/`__Host-`-prefixed name that lacks `Secure`, so
  // an unprefixed-options delete (the old `response.cookies.delete(name)`) silently
  // no-ops on HTTPS — the stale JWT survives and the recover↔middleware loop this
  // route exists to break runs forever. We mirror Auth.js's own cookie options
  // (path `/`, httpOnly, sameSite lax, Secure for prefixed names) so the expiry
  // matches the cookie it's clearing.
  for (const cookie of request.cookies.getAll()) {
    if (!SESSION_COOKIE_RE.test(cookie.name)) continue;
    response.cookies.set(cookie.name, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cookie.name.startsWith('__Secure-') || cookie.name.startsWith('__Host-'),
      maxAge: 0,
    });
  }

  // Don't let any cache (PWA service worker, browser bfcache, intermediate
  // proxy) keep this response: it's the one response that's explicitly
  // clearing a stale auth cookie, and a cached copy would keep stripping
  // valid cookies on later visits.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
