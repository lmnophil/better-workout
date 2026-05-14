// Server-action observability wrapper.
//
// Wrap a server action with `withLogging('actionName', async (...) => {...})`
// to get:
//   - timing observations into the Prometheus histogram
//   - count increments by status (success/error)
//   - structured log on completion (debug for fast, warn for slow > threshold)
//   - error logs distinguishing expected validation failures from bugs
//
// Type inference is preserved — the wrapped function has the exact same signature
// as the original.

import { logger, serializeError } from './logger';
import { metrics } from './metrics';

const SLOW_ACTION_MS = 1000;

/**
 * Errors we throw deliberately as part of normal validation flow (Zod parse
 * failures, "not found", "no active session", etc.) shouldn't pollute error
 * logs with stack traces. These names get logged at warn level without stack.
 *
 * Anything else — null deref, prisma constraint, network — is a bug or incident
 * and gets full stack at error level.
 */
const EXPECTED_ERROR_NAMES = new Set([
  'ZodError',
  'NotFoundError', // Prisma's "record not found"
  'PrismaClientValidationError',
]);

/**
 * Some thrown messages are expected user-facing errors we surface from action
 * bodies (e.g. "No active session"). Match by message prefix to avoid logging
 * them as scary errors. Keep this list in sync with the Error() throws in
 * lib/actions.ts.
 */
const EXPECTED_MESSAGES = [
  'Unauthorized',
  'No active session',
  'You already have',
  'Exercise not found',
  'Exercise not available',
  'Exercise not in active session',
  'Set not found',
  'Cannot edit a completed session',
  'Template not found',
  'Add at least one exercise',
  'This template no longer',
  'That exercise is already in this session',
  'Built-in templates',
  'This template is used in your routine',
  'No routine',
  'You already have a routine',
  'No routine to update',
  'Routine day not found',
  'A routine can have at most',
  'That weekday is already taken',
  'That exercise is already in this day',
  "That exercise isn't in this day's template",
  "That exercise isn't in the template",
  'That exercise is already in the template',
  'This day uses a default template',
  'This day has no usable exercises',
  'Pool not found',
  'Some of those exercises',
  'A pool needs at least',
  'Pick your pool exercises',
  "Two days can't share",
  'Two new templates named',
  "A template can't list",
  'Share link not found',
  'Share link revoked',
  'Reviewer not registered',
  'Comment not found',
  'Suggestion not found',
  'Suggestion already resolved',
  'Comment already resolved',
  'Notification not found',
  'Display name',
  'Comment body',
  'Cannot apply',
  'Not a swap suggestion',
  'Not an insert suggestion',
];

function isExpectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (EXPECTED_ERROR_NAMES.has(err.name)) return true;
  return EXPECTED_MESSAGES.some((m) => err.message.startsWith(m));
}

export function withLogging<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const start = performance.now();
    const log = logger.child({ action: name });

    try {
      const result = await fn(...args);
      const durationMs = performance.now() - start;
      const durationSec = durationMs / 1000;

      metrics.actionsTotal.inc({ action: name, status: 'success' });
      metrics.actionDuration.observe({ action: name, status: 'success' }, durationSec);

      if (durationMs > SLOW_ACTION_MS) {
        log.warn({ durationMs }, 'action.slow');
      } else {
        log.debug({ durationMs }, 'action.complete');
      }

      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      const durationSec = durationMs / 1000;

      metrics.actionsTotal.inc({ action: name, status: 'error' });
      metrics.actionDuration.observe({ action: name, status: 'error' }, durationSec);

      if (isExpectedError(err)) {
        // Expected user-facing error: log at warn, no stack noise.
        log.warn({ durationMs, err: serializeError(err) }, 'action.rejected');
      } else {
        // Genuine bug or incident — full detail.
        log.error({ durationMs, err: serializeError(err) }, 'action.failed');
      }

      throw err;
    }
  };
}
