// Next.js instrumentation hook.
//
// `register()` runs exactly once when the server starts (both in `next dev`
// and in production). This is the right place for boot-time validation,
// telemetry setup, and other one-time work.
//
// We gate by NEXT_RUNTIME so the validator only runs in the Node runtime —
// the Edge runtime doesn't have process.exit() and skipping middleware/edge
// boot avoids duplicate "env validated" logs.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/env');
    validateEnv();
  }
}
