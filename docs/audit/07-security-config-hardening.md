# Package 7: Security and config hardening

Read [README.md](README.md) first. Line numbers as of `94365db` — re-locate by symbol.

Context: the full security audit found the surface fundamentally sound — reviewer identity is
cookie-derived and unforgeable, share tokens are 192-bit, revoked shares are fully closed, no
XSS sinks exist, ownership scoping is consistent. What's left is a short hardening checklist.
The project explicitly does NOT want SaaS hardening (rate-limit tuning, session length) — stay
out of that.

## Findings

1. **`serverActions.allowedOrigins` is the literal `['localhost:3000']` placeholder**
   (next.config.mjs:17-23). Behind the reference Caddy config this works by accident (Caddy
   preserves Host, so Next's origin-vs-forwarded-host check passes without consulting the
   list); behind any Host-rewriting proxy (nginx default `proxy_pass`), every server action —
   i.e. every mutation in the app — 403s while pages render fine. Decide: drive it from
   `AUTH_URL` at build/config time, or delete the entry and rely on Next's host check, and
   either way document the operator requirement in DEPLOY.md (coordinate with Package 8, which
   has DEPLOY.md edits too).

2. **Rate limiting trusts the leftmost `X-Forwarded-For` hop** (lib/request.ts:19-23) — the
   attacker-controlled one, since proxies append. Rotating XFF gets a fresh bucket per request,
   defeating `magicLinkPerIp` (fan out magic-link sends across arbitrary inboxes, burning
   Resend quota) and `clientErrorPerIp` (log flooding). Use the rightmost untrusted hop / a
   trusted-hop offset / `x-real-ip` set by the proxy — match what the reference Caddy config
   actually sends (CADDY.md documents the trust reasoning; keep it accurate).

3. **`videoUrl` accepts `javascript:`/`data:` schemes** (lib/actions.ts:695-701) and renders
   into `<a href>` shown to share reviewers (components/ui/video-link.tsx:26-27 via
   share-view). Zod `.url()` only checks parseability. Constrain to http/https. Check for any
   other user-supplied URL fields while you're at it.

4. **Owner's email leaks to anonymous share visitors** (app/share/[token]/page.tsx:75,92;
   lib/queries.ts:630). `ownerName` falls back to `user.email` — and magic-link-only users
   ALWAYS have `name = null`, so for them the email always shows, pre-registration, to anyone
   holding the URL. Use a non-PII fallback and drop `email` from the select.

5. **Minor (fix if cheap, skip with a note if not):**
   - `/api/metrics` accepts the token as `?token=` query param (route.ts:43-46) — query strings
     land in proxy logs and Referer headers; the Bearer-header path already exists, drop the
     query branch (update the DEPLOY.md scrape examples if they use it — coordinate with
     Package 8).
   - Token comparison there is not constant-time; `crypto.timingSafeEqual` closes it.
   - Public share comment/suggestion/reaction `targetId` is stored without verifying it belongs
     to the share's routine (actions.ts:3911-3941, 4053-4083, 4092-4128). Audited as NOT an
     IDOR (owner apply-paths re-scope by userId), worst case is orphan threads in the owner's
     inbox. A cheap existence check against the shared routine keeps inboxes clean.

## Constraints

- Don't add `requireUser()` to the public share actions, and don't copy their no-auth pattern
  anywhere else (CLAUDE.md).
- Rate-limit _tuning_ is out of scope; finding 2 is about correctness of identity, not limits.
- If Package 1 has landed, new expected validation errors (e.g. URL-scheme rejection) follow
  its transport.

## Verification

- `curl` a server action endpoint with a mismatched Origin against a local prod build to
  confirm the allowedOrigins behavior you chose.
- Spoofed-XFF requests get bucketed by the connection/proxy-derived IP, not the header's
  leftmost value (script it against the dev server).
- Creating a custom exercise with `javascript:alert(1)` as videoUrl is rejected with a friendly
  message; an `https:` URL still works.
- A magic-link user (name = null) mints a share → open it in a clean browser context → no email
  visible anywhere in the page or the serialized RSC payload (view source).
- `npm run typecheck && npm run lint`.
