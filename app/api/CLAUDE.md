# app/api/CLAUDE.md

API routes. Most of the app's mutations go through server actions in `lib/actions.ts`, not here. This directory is for things that genuinely need to be HTTP endpoints: the auth handler, the health check, the metrics scrape, the client-error sink.

If you find yourself wanting to add a new route, ask first whether it should be a server action instead. Reasons to actually need a route:

- Called from outside the React app (Docker healthcheck, Prometheus scraper, browser-side `fetch` from an error boundary)
- Must be unauthenticated by design
- Returns a non-HTML format (JSON, Prometheus exposition, etc.)

Anything else — a server action is simpler.

## Middleware exclusions: critical

`middleware.ts` runs `auth()` on every request the matcher selects, and **redirects unauthenticated requests to `/signin`**. The matcher's job is to exclude paths that should bypass auth.

Currently excluded:
- `api/auth/*` — Auth.js's own callbacks
- `api/healthz` — Docker healthcheck (returning a redirect = "unhealthy" = restart loop = outage)
- `api/metrics` — Prometheus scraper auth is a Bearer token, not a session
- `api/log/*` — error-reporting endpoints must work for unauthenticated clients
- Static assets, manifest, service worker

There's also one **public app page** that bypasses auth — `/share/[token]`. It's handled via `PUBLIC_PATHS` inside `middleware.ts` (the middleware still runs so `req.auth` is populated for the owner previewing their own link, but unauthenticated visitors aren't redirected). The token plus a per-share reviewer cookie are the trust boundary. The public *server actions* that mutate share state (`registerShareReviewer`, `postShareComment`, `postShareSuggestion`, `toggleShareReaction`) are the only mutations in `lib/actions.ts` that skip `requireUser()`. See [docs/decisions.md](../../docs/decisions.md) (`Routine sharing — anonymous public reviewers`). Don't model new public app routes on this casually — the use case is specifically "anonymous reviewer with link from owner."

**If you add a public-or-system endpoint, update the matcher in `middleware.ts`.** Forgetting this means Docker's healthcheck (or Prometheus, or the client-error sink) gets redirected to `/signin`, returns a 307 instead of a 200, and the container is restarted in a loop. Verify any new public endpoint by hitting it with `curl -i` and confirming the status code, not just the body.

The pattern is:

```
'/((?!api/auth|api/healthz|api/metrics|api/log|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|sw.js).*)'
```

Each excluded prefix is `path` or `path-prefix/` — be explicit, don't try to be clever with broad patterns.

## Rate limiting

Public, unauthenticated routes need rate limiting. The `lib/rate-limit.ts` module exports configured token-bucket limiters; reuse them or add a new one if your endpoint has different needs.

Pattern (see `app/api/log/client-error/route.ts` for the canonical example):

```ts
const ip = await getClientIp();
const { allowed, retryAfterSec } = clientErrorPerIp.check(ip);
if (!allowed) {
  return new NextResponse('Too many requests', {
    status: 429,
    headers: { 'Retry-After': String(retryAfterSec) },
  });
}
```

Apply the limit **before** parsing the body — flood attempts shouldn't even get to JSON parsing.

## Authenticated endpoints

If your route does require auth, call `auth()` and check `session?.user?.id`. Don't try to read the JWT manually. Don't pass userId in the body and trust it.

Note that authenticated `/api/*` endpoints still need to be in the middleware matcher's *included* set (i.e. NOT in the exclusion list) so middleware redirects unauthenticated users. If you exclude them from middleware and try to enforce auth in the route handler, you've duplicated machinery.

## Reverse proxy: outside vs inside the network

The app publishes port 3000 on the docker host; an operator-supplied reverse proxy (Caddy / nginx / Traefik) sits in front and handles TLS. The reference Caddy config in `docs/caddy-snippet.example` **404s `/api/metrics`** at the public edge, so the scrape endpoint isn't reachable from the internet. A Prometheus container running inside the same compose network can still reach `app:3000/api/metrics` directly, bypassing the proxy.

If you add another endpoint that should only be reachable from inside the Docker network, mirror that pattern in `docs/caddy-snippet.example` (and remind operators running other reverse proxies to do the equivalent there):

```
handle /api/your-internal-endpoint {
    respond "Not Found" 404
}
```

Default to leaving routes publicly reachable unless there's a clear reason not to.

## Response conventions

- **Status codes:** Use the obvious one. 200 for OK with body, 204 for OK without body, 400 for bad input, 401 for missing auth, 403 for present-but-wrong auth, 404 for "not found" or "intentionally hidden", 429 for rate-limited, 503 for "service intentionally not configured" (e.g. metrics endpoint with no token set).
- **Body format:** JSON for anything an automated client consumes. Plain text for human-readable error pages where the body is more of a hint than data.
- **Cache headers:** System endpoints (healthz, metrics, log sinks) all set `Cache-Control: no-store` or use `dynamic = 'force-dynamic'`. Don't let Next.js cache a healthcheck.

## Things you might want to do that would be wrong

- **Wrapping these routes in `withLogging()`.** That's for server actions. Routes have their own observability story (reverse-proxy access logs + per-route logger.error calls when something goes wrong). Don't double-instrument.
- **Adding a "POST /api/sets" or similar.** Mutations should be server actions, not HTTP routes. Server actions get the entire `lib/actions.ts` machinery for free (auth check, Zod validation, ownership checks, metric instrumentation, error categorization).
- **Putting business logic in routes.** Routes are thin: parse, validate, call a function in `lib/`, return. Anything more belongs in `lib/`.
- **Forgetting to update the middleware matcher when adding a public endpoint.** Worth saying twice.
