// Routine helpers — pure logic, no DB access.
//
// A routine is a thin wrapper around an ordered list of templates. Two
// scheduling styles:
//   - 'sequence': self-paced cycle. Each completed routine session advances
//     the cursor (lastCompletedPosition). "Today's day" = the next position
//     in the cycle.
//   - 'weekday':  each day is pinned to a weekday (0=Sun..6=Sat). Today's
//     weekday picks the day; rest days are weekdays with no pinned day.
//
// Capped at MAX_ROUTINE_DAYS days. The cap matches both modes (weekday is
// naturally bounded by 7) and keeps the timeline UI simple.

export const MAX_ROUTINE_DAYS = 7;

export type ScheduleStyle = 'sequence' | 'weekday';

export const SCHEDULE_STYLES: ScheduleStyle[] = ['sequence', 'weekday'];

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_FULL_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function isScheduleStyle(s: string): s is ScheduleStyle {
  return s === 'sequence' || s === 'weekday';
}

type DayShape = { id: string; position: number; weekday: number | null };
type RoutineShape<D extends DayShape> = {
  scheduleStyle: string;
  lastCompletedPosition: number | null;
  days: D[];
};

/**
 * Pick "today's day" from a routine according to its scheduling style.
 *
 * - Weekday mode: returns the day pinned to today's weekday, or null if
 *   today is a rest day (no day pinned). Today's weekday comes from the
 *   provided Date so server-rendered components can pass a stable reference.
 * - Sequence mode: returns the day at position
 *   ((lastCompletedPosition ?? -1) + 1) mod days.length. The cursor advances
 *   on session completion, so this answers "what's next in your cycle."
 */
export function pickTodaysRoutineDay<D extends DayShape>(
  routine: RoutineShape<D>,
  now: Date = new Date(),
): D | null {
  if (routine.days.length === 0) return null;
  if (routine.scheduleStyle === 'weekday') {
    const today = now.getDay();
    return routine.days.find((d) => d.weekday === today) ?? null;
  }
  // Sequence: walk in position order.
  const sorted = [...routine.days].sort((a, b) => a.position - b.position);
  const nextIndex = ((routine.lastCompletedPosition ?? -1) + 1) % sorted.length;
  return sorted[nextIndex];
}

/**
 * The "upcoming" days after today, capped at MAX_ROUTINE_DAYS - 1 entries
 * (so today + upcoming never exceeds the routine length plus one wrap).
 *
 * - Weekday mode: walks forward from tomorrow through the next 7 days,
 *   emitting any day pinned to that weekday. Rest days are skipped (the UI
 *   composes a full week strip separately if it wants rest days visible).
 * - Sequence mode: lists the days after today's position in cycle order,
 *   wrapping back to position 0. Stops just before reaching today again.
 */
export function pickUpcomingRoutineDays<D extends DayShape>(
  routine: RoutineShape<D>,
  todaysDay: D | null,
  now: Date = new Date(),
): D[] {
  if (routine.days.length === 0) return [];
  if (routine.scheduleStyle === 'weekday') {
    const result: D[] = [];
    const today = now.getDay();
    for (let offset = 1; offset <= 7; offset++) {
      const wd = (today + offset) % 7;
      const match = routine.days.find((d) => d.weekday === wd);
      if (match) result.push(match);
    }
    return result;
  }
  // Sequence: list everything after today's position, in order, wrapping.
  const sorted = [...routine.days].sort((a, b) => a.position - b.position);
  if (!todaysDay) return sorted;
  const todaysIndex = sorted.findIndex((d) => d.id === todaysDay.id);
  if (todaysIndex < 0) return sorted;
  const result: D[] = [];
  for (let i = 1; i < sorted.length; i++) {
    result.push(sorted[(todaysIndex + i) % sorted.length]);
  }
  return result;
}
