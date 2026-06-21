# Caddy

How to put this app behind a Caddy instance that runs on a different server.

The standard deploy assumes you bring your own reverse proxy. This doc covers the specific case where that reverse proxy lives on its own box (your "edge" server, the one your router forwards `:80` and `:443` to) and the app lives somewhere else (LXC, VM, another physical host on the same LAN).

If your Caddy and the app are on the same host, you don't need this — follow [`DEPLOY.md`](./DEPLOY.md) and paste [`docs/caddy-snippet.example`](./docs/caddy-snippet.example) as-is.

## You don't need a second Caddy on the app server

A single Caddy on your edge server can `reverse_proxy` directly to the app server's `:3000` across your LAN. One extra network hop instead of two, no second TLS termination, no second cert to manage.

Rate limiting doesn't change that. The app does its own rate limiting in [`lib/rate-limit.ts`](./lib/rate-limit.ts) — magic-link sends per IP and per email, plus client-error reports per IP. It runs in-process, in-memory, and reads the client IP from `X-Forwarded-For` via [`lib/request.ts`](./lib/request.ts). It works the same whether Caddy sits on the same box or across the LAN, as long as the trust chain is intact (see "Trust chain" below).

## The setup

```
[ internet ] ──443──> [ edge server: Caddy ] ──3000──> [ app server: Docker compose ]
                          │
                          DNS, TLS certs, port forwarding terminate here
```

### 1. App server — make `:3000` reachable from the edge server, and only from there

The app container publishes port 3000. By default `docker-compose.yml` binds it to all interfaces. For a cross-server setup you want it reachable on the LAN but not on the public internet, and ideally not from random LAN devices either.

Two reasonable shapes — pick one.

**Bind to a specific LAN IP** in `docker-compose.yml`:

```yaml
ports:
  - '192.168.1.42:3000:3000' # the app server's own LAN IP
```

This stops Docker from listening on every interface on the host — useful if the app server has multiple NICs or a public IP you don't want exposing `:3000`.

**Or, bind to all interfaces and firewall it** — looser app-side, easier if DHCP changes the LAN IP:

```yaml
ports:
  - '3000:3000'
```

…and on the app server:

```bash
sudo ufw allow from 192.168.1.10 to any port 3000   # edge server's LAN IP
sudo ufw deny 3000                                   # everything else
```

Either way, **do not port-forward `:3000` from your router**. The internet path is `443 → edge Caddy → 3000 over LAN`. There is no reason for `:3000` to be reachable from outside.

### 2. Edge server — Caddy config

Use [`docs/caddy-snippet.example`](./docs/caddy-snippet.example) as the starting point. The only thing that changes for cross-server is the upstream:

```caddyfile
reverse_proxy 192.168.1.42:3000 {
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-Host {host}
}
```

…where `192.168.1.42` is the **app server's** LAN IP (from Caddy's vantage point). Everything else in the snippet — security headers, `/api/metrics` 404, static-asset caching, service-worker headers — works identically across the LAN.

### 3. `AUTH_URL` on the app server

Set `AUTH_URL` in the app's `.env` to your **public** URL (e.g. `https://workout.example.com`), not a LAN IP and not `http://localhost:3000`. Auth.js builds OAuth callback and magic-link URLs from this; if it's wrong, Google sign-in returns `redirect_uri_mismatch` and magic-link emails arrive with broken links.

The Google Cloud Console redirect URI must match exactly: `https://workout.example.com/api/auth/callback/google`.

### 4. DNS + router

Same as the standard deploy:

- `A` record for `workout.example.com` → your public IP.
- Router forwards `80` and `443` (TCP) to the **edge server**, not the app server.
- Don't forward `:3000` anywhere.

## Trust chain — how the client IP is derived

`getClientIp()` in [`lib/request.ts`](./lib/request.ts) derives the rate-limit key from `X-Forwarded-For`, and it deliberately does **not** trust the leftmost entry. The leftmost value is whatever the original client sent — a client can put `X-Forwarded-For: 1.2.3.4` on the wire and the first proxy just appends the real source after it, so trusting it lets an attacker rotate the value for a fresh rate-limit bucket per request.

Instead it walks the header from the **right**, skipping hops on private / loopback / link-local ranges (your own proxy infrastructure — every proxy here reaches the app over a private network), and takes the first public address it finds. That's the closest hop a proxy you control vouched for; a forged leftmost value is ignored. With no public hop present it falls back to `X-Real-IP` (set by the immediate proxy from the socket peer), then to a single shared `unknown` bucket.

In the simple single-proxy setup:

1. Internet client connects to edge Caddy on `:443`.
2. Caddy sets `X-Forwarded-For: <client-ip>` (and `X-Real-IP`, `X-Forwarded-Proto`).
3. Caddy connects to the app server's `:3000` over LAN.
4. App reads the headers Caddy set; `<client-ip>` is the only non-private hop, so it's the key.

The app server's `:3000` is firewalled or bound so only the edge Caddy can reach it (step 1 of the previous section). Nobody else can submit a request the app sees — so nobody else can plant an `X-Forwarded-For` that survives. **The firewall step isn't optional cosmetics — it's what makes the rest of this safe.** If `:3000` is reachable from the wider LAN (or the internet), an attacker can hit the app directly and set any header — including a private-range `X-Forwarded-For` the app would treat as trusted infrastructure — bypassing per-IP limits and polluting logs.

### A proxy in front of Caddy (tunnels: Pangolin/newt, Cloudflare, etc.)

If Caddy isn't your edge — traffic arrives as `internet → tunnel → newt → Caddy → app` — then Caddy's immediate peer is the tunnel, not the client, and the reference snippet's `header_up X-Forwarded-For {remote_host}` would **overwrite** the chain with the tunnel's private IP. The app would then see only private hops and bucket every external user together (the "rate limits hitting unrelated users" symptom below).

Fix it by having Caddy preserve the real client IP the upstream already wrote into `X-Forwarded-For` rather than replacing it. Mark the upstream trusted so Caddy appends instead of overwriting:

```caddyfile
reverse_proxy app:3000 {
    trusted_proxies static 192.168.4.11   # the tunnel/newt IP (or a private CIDR)
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-Proto {scheme}
    # No `header_up X-Forwarded-For` line here: with trusted_proxies set, Caddy
    # keeps the upstream client IP and appends its own peer, so the app's
    # right-to-left walk lands on the real client.
}
```

The thing furthest upstream (the tunnel's own public edge) must be what writes the genuine client IP into `X-Forwarded-For` to begin with. Confirm with the log check below: the recorded client IP should be a real public address, not `192.168.x.x`.

## Verifying it works

From the edge server:

```bash
curl -i http://192.168.1.42:3000/api/healthz
# expect: HTTP/1.1 200, {"status":"ok",...}
```

From a laptop on the same LAN, but _not_ the edge server:

```bash
curl -i http://192.168.1.42:3000/api/healthz
# expect: connection refused or timeout — if it succeeds, your firewall isn't doing its job
```

From anywhere on the internet:

```bash
curl -i https://workout.example.com/api/healthz
# expect: HTTP/2 200, {"status":"ok",...}
```

In the app logs, after a sign-in attempt:

```bash
docker compose logs app | jq -c 'select(.msg=="auth.signin")'
```

The logged client IP should be your real public IP, not `192.168.x.x`. If it's the edge server's LAN IP, the `X-Forwarded-For` plumbing is broken — re-check the `header_up` lines in the edge Caddyfile.

## Troubleshooting

**`502 Bad Gateway` from the edge.** Caddy can't reach the app. From the edge server: `curl -i http://<app-server-lan-ip>:3000/api/healthz`. Failure means the app's port isn't reachable (firewall too strict, wrong IP, app not running, Docker bound to a different interface). Success but still 502 in browser → Caddyfile upstream is pointed somewhere else.

**Rate limits hitting unrelated users.** Every request looks like it's coming from one IP. `getClientIp()` keys off the rightmost _public_ `X-Forwarded-For` hop; if all it sees are private addresses, every external user shares one bucket. Either the edge Caddy isn't forwarding a client IP at all (re-check the `header_up X-Forwarded-For` / `X-Real-IP` lines), or there's a proxy in front of Caddy and Caddy is overwriting the real client with the tunnel's IP — see "A proxy in front of Caddy" above.

**`OAuthCallbackError: redirect_uri_mismatch`.** `AUTH_URL` in `.env` doesn't match the URL the user reached you on, or doesn't match what's registered in Google Cloud Console. It must be the _public_ URL the user typed, with the exact scheme and host.

**Magic links contain `http://192.168...` or `localhost`.** `AUTH_URL` on the app server is wrong. Auth.js uses it verbatim to build links. Fix it and `docker compose up -d app` to pick up the change.

**Service worker stuck on an old version.** Not specific to cross-server. Hard-refresh, or unregister via dev tools → Application → Service Workers.
