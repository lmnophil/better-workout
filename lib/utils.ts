// Tiny shared helpers.

/**
 * Days between two dates, rounded down. Uses local-time day boundaries.
 */
export function daysBetween(earlier: Date, later: Date = new Date()): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Friendly relative-time label: "today", "1d ago", "3d ago", etc.
 */
export function relativeDay(date: Date, now: Date = new Date()): string {
  const d = daysBetween(date, now);
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
