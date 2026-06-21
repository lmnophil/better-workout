// Server-side resolution of the user's timezone.
//
// "What calendar day is it?" can only be answered with the user's zone, and the
// browser is the authoritative source. <TimeZoneSync> (a client component in the
// app layout) writes the browser's detected IANA zone into the `tz` cookie; the
// server reads it here and feeds it to every "what day is it" consumer — the
// routine weekday picker and the coverage recency labels. See the ADR in
// docs/decisions.md.
//
// Importing next/headers makes this module server-only by construction; it must
// never be pulled into a client component.

import { cookies } from 'next/headers';
import { TIMEZONE_COOKIE } from './utils';

// Until the cookie lands (a brand-new visit, before TimeZoneSync runs) or if
// it's missing/garbage, fall back to UTC — the same zone the documented Docker
// deployment runs as, so behaviour degrades to the pre-fix baseline rather than
// to something surprising.
const FALLBACK_TIMEZONE = 'UTC';

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    // Constructing a formatter with an unknown zone throws a RangeError.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The user's resolved IANA timezone for this request.
 */
export async function getRequestTimeZone(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(TIMEZONE_COOKIE)?.value;
  return isValidTimeZone(raw) ? raw : FALLBACK_TIMEZONE;
}
