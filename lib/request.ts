// Request helpers — extract client info from headers in server actions.
//
// The app runs behind one or more reverse proxies it controls (Caddy, and
// optionally a tunnel such as Pangolin/newt in front of it). Each proxy appends
// the peer it saw to X-Forwarded-For, so the header reads left-to-right as
// [maybe-forged…, real client, proxy1, proxy2]. The *leftmost* entry is whatever
// the original client put there — fully attacker-controlled, since a client can
// send `X-Forwarded-For: 1.2.3.4` and the first proxy just appends the real
// source after it. Keying a rate limit off the leftmost value lets an attacker
// rotate it to mint a fresh bucket per request, defeating the magic-link and
// client-error limiters entirely.
//
// So we read from the RIGHT: walk inward past the hops we recognise as our own
// proxy infrastructure and take the first entry a trusted proxy vouched for.
// That entry is proxy-written, not client-settable, so it's a stable key. The
// deployment model puts every proxy on a private network with :3000 firewalled
// to the proxy (see CADDY.md), so "our infrastructure" is any private / loopback
// / link-local address — and the first public address, reading right-to-left, is
// the real client.

import { headers } from 'next/headers';

// Trusted reverse-proxy ranges, as [network, mask] pairs of unsigned 32-bit
// IPv4 ints. Every proxy hop in this deployment reaches the app over a private
// network, so a private/loopback/link-local address in X-Forwarded-For is our
// own infrastructure to skip past. (IPv6 proxies are handled separately below;
// a *public* IPv6 client simply isn't trusted and is returned as the client.)
const TRUSTED_V4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  v4Cidr('127.0.0.0', 8), // loopback
  v4Cidr('10.0.0.0', 8), // RFC1918
  v4Cidr('172.16.0.0', 12), // RFC1918
  v4Cidr('192.168.0.0', 16), // RFC1918
  v4Cidr('169.254.0.0', 16), // link-local
];

function v4Cidr(base: string, bits: number): readonly [number, number] {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [(ipv4ToInt(base) & mask) >>> 0, mask];
}

// Dotted-quad → unsigned 32-bit int, or NaN if it isn't a well-formed IPv4
// literal (which also covers "give me an IPv6 address").
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return NaN;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return NaN;
    n = ((n << 8) | octet) >>> 0;
  }
  return n;
}

// Normalise a forwarded entry to a comparable address: drop a bracketed-IPv6
// wrapper, a zone id, and an IPv4-mapped IPv6 prefix so "[::ffff:1.2.3.4]" and
// "1.2.3.4" collapse to one key (and one rate-limit bucket).
function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return mapped ? mapped[1] : ip;
}

function isTrustedProxy(raw: string): boolean {
  const ip = normalizeIp(raw).toLowerCase();
  // IPv6 infrastructure: loopback, unique-local (fc00::/7), link-local (fe80::/10).
  if (ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(ip)) return true;
  const n = ipv4ToInt(ip);
  if (Number.isNaN(n)) return false;
  return TRUSTED_V4_CIDRS.some(([net, mask]) => (n & mask) >>> 0 === net);
}

/**
 * Best-effort client IP for rate-limit keying. Returns the rightmost
 * X-Forwarded-For hop that our own proxy chain didn't add, normalised. Falls
 * back to "unknown" rather than throwing — callers treat "unknown" as a
 * rate-limit key like any other (a shared bucket, which fails safe).
 *
 * SECURITY: never trusts a client-supplied value. The returned address is
 * always one a trusted proxy wrote (or X-Real-IP / "unknown"), so an attacker
 * can't rotate it for fresh buckets. This holds only because :3000 is firewalled
 * to the proxy — a directly-reachable app could be fed any header (see CADDY.md).
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();

  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isTrustedProxy(hops[i])) return normalizeIp(hops[i]);
    }
  }

  // Every forwarded hop was our own infrastructure (or the header was absent).
  // X-Real-IP is set by the immediate proxy from the socket peer — not forgeable
  // by the client under the firewalled-:3000 model — so prefer it before giving
  // up to a single shared bucket. A coarse bucket here means the operator's proxy
  // chain isn't preserving the real client IP; CADDY.md covers fixing that.
  const realIp = h.get('x-real-ip');
  if (realIp) {
    const ip = normalizeIp(realIp);
    if (ip) return ip;
  }

  return 'unknown';
}
