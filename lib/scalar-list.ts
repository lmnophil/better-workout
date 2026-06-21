// SQLite has no native array column type, so the list-valued Exercise columns —
// equipment, primaryMuscles, secondaryMuscles — are stored as JSON-encoded text
// (see the note on Exercise.equipment in prisma/schema.prisma). These helpers
// convert at the data-access boundary in lib/queries.ts and lib/actions.ts so
// everything above that layer keeps working with plain string[].
//
// parseStringList is deliberately forgiving: a malformed or non-array value
// degrades to [] rather than throwing, matching how the rest of the app treats
// a missing list (empty = "no muscles / no equipment").

export function serializeStringList(list: readonly string[]): string {
  return JSON.stringify(list);
}

export function parseStringList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
