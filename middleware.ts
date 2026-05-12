// Middleware: route protection.
//
// Runs on the Edge runtime, so it imports auth.config.ts (Edge-safe).
// Redirects unauthenticated users to /signin and bounces authenticated
// users away from /signin and /verify-request.

import NextAuth from 'next-auth';
import authConfig from './auth.config';

const { auth } = NextAuth(authConfig);

// Public app paths — the middleware runs (so `req.auth` is populated for any
// signed-in viewer), but unauthenticated users are not redirected away. The
// share route is the only authenticated-or-anonymous app route in the app;
// access control inside lives on the per-share token + reviewer cookie. See
// docs/decisions.md (`Routine sharing — anonymous public reviewers`).
const PUBLIC_PATHS = ['/signin', '/verify-request', '/share/'];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isPublicPath = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p));

  if (!isLoggedIn && !isPublicPath) {
    const url = new URL('/signin', nextUrl);
    // Preserve where the user was trying to go so we can return them after login
    if (nextUrl.pathname !== '/') {
      url.searchParams.set('callbackUrl', nextUrl.pathname);
    }
    return Response.redirect(url);
  }

  // Bounce already-signed-in users away from /signin and /verify-request, but
  // don't bounce them away from /share/<token> — owners need to be able to
  // visit their own share links to preview them.
  const isSigninPath =
    nextUrl.pathname.startsWith('/signin') || nextUrl.pathname.startsWith('/verify-request');
  if (isLoggedIn && isSigninPath) {
    return Response.redirect(new URL('/', nextUrl));
  }
});

// Match every path EXCEPT static assets, the auth API, system endpoints, and
// the manifest/sw.
//
// Auth.js's own callback routes need to bypass middleware so OAuth can complete.
// Health checks, metrics scrapes, and client error reports are unauthenticated
// by design — middleware redirecting them to /signin would turn into an outage
// (Docker healthcheck reads HTTP 200 only; a redirect = "unhealthy" = restart).
export const config = {
  matcher: [
    '/((?!api/auth|api/healthz|api/metrics|api/log|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|sw.js).*)',
  ],
};
