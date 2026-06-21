// Tiny shared helpers.

// Cookie the client writes with its detected IANA timezone (see TimeZoneSync).
// Lives here, in a dependency-free module, so both the client setter and the
// server reader can share the name without pulling next/headers into the bundle.
export const TIMEZONE_COOKIE = 'tz';

/**
 * Whole-day index (days since the Unix epoch) for a date as seen in a given
 * IANA timezone, or in the runtime's local zone when `timeZone` is omitted.
 *
 * Comparing two day indices yields a *calendar-day* delta that's stable across
 * time-of-day and DST — "yesterday 9pm" and "today 7am" land one apart, not
 * zero. In a client component, omitting `timeZone` is correct: "local" is the
 * user's own browser zone. On the server (where local time is whatever the
 * container runs as, usually UTC) callers pass the user's resolved zone.
 */
function localDayNumber(date: Date, timeZone?: string): number {
  let year: number;
  let month: number;
  let day: number;
  if (timeZone) {
    // en-CA renders an ISO-ish "YYYY-MM-DD" we can split without locale surprises.
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(date)
      .split('-')
      .map(Number);
    year = y;
    month = m;
    day = d;
  } else {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }
  // UTC math on the resolved y/m/d keeps the subtraction itself zone-free.
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Weekday (0=Sun..6=Sat) for a date in the given IANA timezone, or the runtime
 * local zone when `timeZone` is omitted.
 */
export function localWeekday(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getDay();
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

/**
 * Calendar days between two dates (whole days, signed: positive when `later` is
 * after `earlier`). Truncates both to their local day before diffing, so it's a
 * count of midnights crossed, not elapsed 24-hour blocks. Pass `timeZone` to
 * resolve "local" against a specific zone (server-side); omit it in the browser.
 */
export function daysBetween(earlier: Date, later: Date = new Date(), timeZone?: string): number {
  return localDayNumber(later, timeZone) - localDayNumber(earlier, timeZone);
}

/**
 * Friendly relative-time label: "today", "1d ago", "3d ago", etc.
 */
export function relativeDay(date: Date, now: Date = new Date(), timeZone?: string): string {
  const d = daysBetween(date, now, timeZone);
  if (d <= 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

/**
 * Group an array by a key extractor — handy for "sets grouped by exerciseId."
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    let bucket = map.get(k);
    if (!bucket) {
      bucket = [];
      map.set(k, bucket);
    }
    bucket.push(item);
  }
  return map;
}
