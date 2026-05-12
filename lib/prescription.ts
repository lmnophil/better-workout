// Prescription string parsing.
//
// Prescriptions are free-form strings authored on each exercise — both the
// built-in seeds and any customs the user creates ("3×12, 5-sec hold",
// "2×8 per side", "1 min per side"). They're a hint, not structured data —
// the schema doesn't constrain them. We do a conservative parse to extract
// a set count for set-seeding, and bail out (return null) for anything that
// doesn't fit a clear "<N>×<reps>" lead.
//
// History from prior sessions outranks the prescription as a seeding source,
// so a wrong parse here is recoverable — the next time the user logs the
// exercise, last-time wins and the prescription is no longer consulted.

const COUNT_AT_LEAD = /^\s*(\d+)\s*[×x*]/;

/**
 * Pull the leading set count from a prescription string.
 *   "3×12"               → 3
 *   "3×10–12, neutral"   → 3
 *   "2x8 per side"       → 2
 *   "1 min per side"     → null  (no leading "N×")
 *   "30s, controlled"    → null
 *   undefined / empty    → null
 */
export function parsePrescriptionSetCount(prescription: string | null | undefined): number | null {
  if (!prescription) return null;
  const match = COUNT_AT_LEAD.exec(prescription);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 20) return null;
  return n;
}
