// Boot-time environment validation.
//
// Imported once from instrumentation.ts so it runs at server startup.
// On missing required vars, logs every problem at once (not just the first)
// and exits with code 1 — fail fast, fail loud.
//
// Why custom code instead of Zod's env helpers: we want a) zero runtime cost
// after first load, b) very explicit operator-friendly error messages, and
// c) different policy for required-everywhere vs prod-only vs warnings.

import { logger } from './logger';

type EnvCheck = {
  name: string;
  // 'required'  — must be set or boot fails
  // 'recommended' — boot continues but logs a loud warning
  // 'prod-required' — required only when NODE_ENV=production
  level: 'required' | 'recommended' | 'prod-required';
  // Quick description for the error message
  description: string;
  // Optional validation beyond presence (return error message string, or null/undefined for ok)
  validate?: (value: string) => string | null | undefined;
};

const CHECKS: EnvCheck[] = [
  {
    name: 'AUTH_SECRET',
    level: 'required',
    description: 'Auth.js JWT signing key. Generate: openssl rand -base64 32',
    validate: (v) =>
      v.length < 16 ? 'too short — must be at least 16 chars (32 recommended)' : null,
  },
  {
    name: 'AUTH_URL',
    level: 'required',
    description: 'Public URL of the app (e.g. https://workout.example.com)',
    validate: (v) => {
      try {
        new URL(v);
        return null;
      } catch {
        return 'must be a full URL with protocol (https://… or http://…)';
      }
    },
  },
  {
    name: 'DATABASE_URL',
    level: 'required',
    description: 'Postgres connection string',
    validate: (v) =>
      v.startsWith('postgres://') || v.startsWith('postgresql://')
        ? null
        : "must start with 'postgres://' or 'postgresql://'",
  },
  {
    name: 'AUTH_GOOGLE_ID',
    level: 'recommended',
    description:
      'Google OAuth client ID. Without this, Google sign-in is unavailable (magic links still work).',
  },
  {
    name: 'AUTH_GOOGLE_SECRET',
    level: 'recommended',
    description: 'Google OAuth client secret (paired with AUTH_GOOGLE_ID).',
  },
  {
    name: 'AUTH_RESEND_KEY',
    level: 'recommended',
    description:
      'Resend API key. Without this, magic-link sign-in is unavailable (Google sign-in still works).',
  },
  {
    name: 'AUTH_EMAIL_FROM',
    level: 'recommended',
    description: 'From-address for magic-link emails.',
  },
  {
    name: 'METRICS_TOKEN',
    level: 'prod-required',
    description:
      'Bearer token for /api/metrics. Without this, the metrics endpoint returns 503. Generate: openssl rand -hex 32',
    validate: (v) =>
      v.length < 16 ? 'too short — must be at least 16 chars (32 recommended)' : null,
  },
];

/**
 * Run all checks. Logs all problems, throws on hard failures.
 * Idempotent — safe to call multiple times.
 */
export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of CHECKS) {
    const raw = process.env[check.name];

    // Treat prod-required as required when in prod, recommended otherwise
    const effectiveLevel =
      check.level === 'prod-required' ? (isProd ? 'required' : 'recommended') : check.level;

    if (raw === undefined || raw.trim() === '') {
      const msg = `${check.name} is not set — ${check.description}`;
      if (effectiveLevel === 'required') {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
      continue;
    }

    // Run validator if present
    if (check.validate) {
      const problem = check.validate(raw);
      if (problem) {
        errors.push(`${check.name} is invalid: ${problem}`);
      }
    }
  }

  for (const w of warnings) {
    logger.warn({ check: 'env' }, `env.warning: ${w}`);
  }

  if (errors.length > 0) {
    // Log each error individually so they're each greppable
    for (const e of errors) {
      logger.fatal({ check: 'env' }, `env.error: ${e}`);
    }
    // One summary message, then exit. Not throwing — Next.js would catch and
    // hide it; an explicit exit makes Docker/orchestrators see the failure
    // clearly via the container exit code.
    logger.fatal(
      { errorCount: errors.length },
      `Environment validation failed. See errors above. Aborting startup.`,
    );
    process.exit(1);
  }

  logger.info({ warningCount: warnings.length }, 'env.validated');
}
