// Structured logger for the whole app. Writes JSON to stdout — Docker captures
// it by default, and from there you can pipe to Loki/CloudWatch/whatever.
//
// In dev, pipe through pino-pretty for readable output:
//   npm run dev | pino-pretty
// (or use the `dev:pretty` script if added to package.json)
//
// Log levels: trace < debug < info < warn < error < fatal
// Default: info in prod, debug in dev. Override with LOG_LEVEL.
//
// Sensitive fields are auto-redacted via the `redact` config below — emails,
// auth tokens, cookies. Add new paths there as new sensitive fields appear.

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: {
    app: 'workout-tracker',
    env: process.env.NODE_ENV,
  },
  // ISO 8601 timestamps are easier for humans and aggregators alike.
  timestamp: pino.stdTimeFunctions.isoTime,
  // Auto-redact sensitive fields anywhere in the log payload. Wildcards traverse
  // one level — for deeper nesting, add explicit paths.
  redact: {
    paths: [
      'email',
      'user.email',
      'session.user.email',
      'token',
      '*.token',
      'password',
      'authorization',
      'cookie',
      'headers.cookie',
      'headers.authorization',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Convert anything that might have been thrown into a serializable shape.
 * Errors don't JSON-stringify by default (their fields are non-enumerable), so
 * we extract what we want.
 */
export function serializeError(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      // Some auth errors carry extra context (cause, code)
      cause: err.cause instanceof Error ? err.cause.message : err.cause,
    };
  }
  return { value: String(err) };
}
