// Server-action observability wrapper.
//
// Wrap a server action with `withLogging('actionName', async (...) => {...})`
// to get:
//   - timing observations into the Prometheus histogram
//   - count increments by status (success/error)
//   - structured log on completion (debug for fast, warn for slow > threshold)
//   - the expected-error transport: `ExpectedError` throws become
//     `{ ok: false, error }` results that survive prod's message redaction
//
// The wrapped function returns `ActionResult<T>` where the original returned
// `T` — success is `{ ok: true, data }`. See lib/action-result.ts for why.

import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { ExpectedError, type ActionResult } from './action-result';
import { logger, serializeError } from './logger';
import { metrics } from './metrics';

const SLOW_ACTION_MS = 1000;

export function withLogging<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<ActionResult<TReturn>> {
  return async (...args: TArgs): Promise<ActionResult<TReturn>> => {
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

      return { ok: true, data: result };
    } catch (err) {
      // Next's control-flow "errors" (redirect from requireUser, notFound)
      // must propagate untouched for the framework to act on them. They're
      // not failures, so they skip metrics and logging entirely.
      unstable_rethrow(err);

      const durationMs = performance.now() - start;
      const durationSec = durationMs / 1000;

      metrics.actionsTotal.inc({ action: name, status: 'error' });
      metrics.actionDuration.observe({ action: name, status: 'error' }, durationSec);

      if (err instanceof ExpectedError) {
        // Expected user-facing failure: log at warn without stack noise (the
        // `reason` key dodges pino's Error serializer) and hand the message to
        // the client as data, where prod can't redact it.
        log.warn({ durationMs, reason: err.message }, 'action.rejected');
        return { ok: false, error: err.message };
      }

      if (err instanceof ZodError) {
        // A Zod parse failure means the client sent a malformed payload —
        // a client bug or a stale tab, not a user mistake. Log the issues
        // (they're compact and point at the bad field) but don't surface
        // Zod's internals to the user.
        log.warn({ durationMs, reason: 'invalid input', issues: err.issues }, 'action.rejected');
        return { ok: false, error: 'Invalid input — try refreshing the page.' };
      }

      // Genuine bug or incident — full detail, and rethrow so it reaches the
      // nearest error boundary.
      log.error({ durationMs, err: serializeError(err) }, 'action.failed');
      throw err;
    }
  };
}
