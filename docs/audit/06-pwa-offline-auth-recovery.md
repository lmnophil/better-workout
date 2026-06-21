# Package 6: PWA offline fallback and HTTPS auth recovery

Read [README.md](README.md) first. Line numbers as of `94365db` — re-locate by symbol.
Theme: features that work on HTTP localhost and silently break in the real (HTTPS, prod-build,
Docker) deployment. Verification therefore REQUIRES a prod build; dev mode proves nothing here.

## Findings

1. **The offline fallback never fires** (app/sw.ts:45-52, next.config.mjs). Serwist's
   `fallbacks` serves the fallback via `matchPrecache(url)` — the URL must be in the precache
   manifest. The built `public/sw.js` manifest contains only `_next/static/*` and `public/`
   files; `@serwist/next` never precaches fallback URLs. So `matchPrecache('/offline')` is
   always undefined and offline navigation to an uncached page shows the browser error page —
   `app/offline/page.tsx` and its `auto-reload.tsx` are dead code. Fix direction:
   `additionalPrecacheEntries: [{ url: '/offline', revision: <build-stable hash> }]` in
   `withSerwistInit` — but verify against the installed Serwist version's API, not this brief.

2. **`/offline` is auth-gated by middleware** (middleware.ts:17,52) — paired with fix 1. The SW
   typically installs while the user sits on `/signin` (signed out); its install-time fetch of
   `/offline` would get a 302 to the sign-in page and **precache the sign-in HTML as the
   offline fallback**. Add `/offline` to `PUBLIC_PATHS` (or matcher exclusions) as part of
   fix 1, and note the new public path in the middleware ADR per CLAUDE.md's rule about public
   routes.

3. **Stale-cookie recovery infinite-loops on HTTPS** (app/api/auth/recover/route.ts:33-35).
   `response.cookies.delete('__Secure-authjs.session-token')` emits a Set-Cookie without the
   `Secure` attribute; browsers REJECT any Set-Cookie for a `__Secure-`-prefixed name lacking
   `Secure`. So after `prisma migrate reset` on a prod deployment, the stale JWT survives
   deletion and the exact loop this route exists to break (middleware sees valid token → `/` →
   layout sees no user → recover → `/signin` → middleware bounces back…) runs forever. Works on
   HTTP localhost (unprefixed cookie name), which is why dev never catches it. Fix: pass the
   cookie options (`path: '/'`, `secure` for prefixed names), and handle the chunked
   `…session-token.0/.1` variants Auth.js emits for large JWTs.

4. **Redirect-flow nits, same neighborhood:**
   - middleware.ts:28 — `callbackUrl` preserves only `pathname`, dropping the query string.
   - app/(auth)/signin/page.tsx:45,66,76 — error redirects (`/signin?error=…`) drop
     `callbackUrl`, so a retry lands on `/` instead of the original destination.

5. **No root `not-found.tsx`** — `notFound()` from `/routine/shares/[shareId]` (and any unknown
   URL) renders Next's unstyled default 404, jarring against the app's dark theme. Add
   `app/not-found.tsx` consistent with the existing boundaries.

## Constraints

- `skipWaiting: false` + the update-prompt flow and `USER_SCOPED_CACHE_RE` cache hygiene in
  `app/sw.ts` were audited and are correct — don't disturb them.
- `/share/[token]` is currently the only public app route; adding `/offline` to PUBLIC_PATHS is
  the sanctioned second one — update the ADR in docs/decisions.md and app/api/CLAUDE.md per the
  maintenance contract.
- The recover route's purpose and the stale-JWT design are documented in auth.ts comments and
  decisions.md — read them before changing behavior.

## Verification

All in a production build (`npm run build && npm start`, or the Docker image):

- Offline fallback: load the app signed in, then DevTools → offline → navigate to a page not in
  the runtime cache → the styled `/offline` page appears (not a browser error). Also verify the
  _signed-out_ install path doesn't cache sign-in HTML as the fallback (clear SW + storage,
  install while signed out, then test).
- Recovery loop: HTTPS is required to reproduce (cookie prefix rules). Either run behind a
  local Caddy/mkcert HTTPS proxy, or — minimum bar — assert the emitted Set-Cookie headers
  carry `Secure` and the right `Path` for the prefixed names, including chunked variants, with
  a direct request to `/api/auth/recover`. State plainly in your summary which level of
  verification you achieved.
- Sign out, visit `/some/deep/path?with=query`, sign in → land on the full original URL.
- Visit a garbage URL → styled 404.
- `npm run typecheck && npm run lint`.
