// Health check — returns 200 if the app can talk to the database, 503 if not.
//
// Used by:
//   - Docker HEALTHCHECK (so compose knows when to start dependent services
//     and when to restart a sick container)
//   - Any external uptime monitoring (Uptime Kuma, BetterStack, etc.)
//
// Deliberately not authenticated and doesn't go through `withLogging`. Health
// checks fire every ~30s; they shouldn't pollute action metrics or logs.
// Failures still get a single warn-level log line so you can spot DB outages.

import { db } from '@/lib/db';
import { logger, serializeError } from '@/lib/logger';
import { NextResponse } from 'next/server';

// Force runtime evaluation — never cache a health check.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const start = performance.now();
  try {
    // Lightest possible round-trip to the DB. Casting confirms the connection
    // is live and the query path works end-to-end (driver, network, server).
    await db.$queryRaw`SELECT 1`;
    const durationMs = Math.round(performance.now() - start);
    return NextResponse.json(
      { status: 'ok', durationMs },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    // Single warn line — don't error-log to avoid waking on-call for transient
    // blips that the readiness retry will absorb. Repeated failures will show
    // up in Docker's restart logs / orchestrator alerts.
    logger.warn({ durationMs, err: serializeError(err) }, 'healthz.db_unavailable');
    return NextResponse.json(
      { status: 'unhealthy', durationMs },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
