// Request helpers — extract client info from headers in server actions.
//
// Behind a reverse proxy with sane defaults, X-Forwarded-For contains a
// comma-separated list of IPs, with the original client first.

import { headers } from 'next/headers';

/**
 * Best-effort client IP. Falls back to "unknown" rather than throwing —
 * callers should treat "unknown" as a rate-limit key like any other.
 *
 * SECURITY NOTE: only trust X-Forwarded-For when running behind a reverse
 * proxy you control (the case here). On a directly-exposed server, this
 * header is spoofable.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();

  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = h.get('x-real-ip');
  if (realIp) return realIp;

  return 'unknown';
}
