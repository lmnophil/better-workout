// Prisma client singleton with structured logging hooks.
//
// In dev, Next.js hot-reload would otherwise spawn a new client on every
// request, exhausting the connection pool. This pattern caches one instance
// on globalThis.
//
// Query timing is recorded into Prometheus regardless of speed; queries over
// SLOW_QUERY_MS get an extra log warning so they're easy to spot in stderr.

import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { metrics } from './metrics';

const SLOW_QUERY_MS = 100;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function makeClient() {
  const client = new PrismaClient({
    // Emit events instead of logging to console so we can route them through
    // the structured logger and metrics.
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  client.$on('query', (e) => {
    // Try to bucket by operation type (SELECT/INSERT/UPDATE/DELETE/etc.) so
    // the histogram has useful labels without exploding cardinality.
    const operation = e.query.match(/^\s*(\w+)/)?.[1]?.toUpperCase() ?? 'OTHER';
    metrics.dbQueryDuration.observe({ operation }, e.duration / 1000);

    if (e.duration >= SLOW_QUERY_MS) {
      // Log the SQL (with placeholders) but NOT the params — params can contain
      // user data and we don't want them in logs.
      logger.warn(
        {
          durationMs: e.duration,
          operation,
          query: e.query.length > 300 ? e.query.slice(0, 300) + '…' : e.query,
        },
        'db.slow_query',
      );
    }
  });

  client.$on('error', (e) => {
    logger.error({ message: e.message, target: e.target }, 'db.error');
  });

  client.$on('warn', (e) => {
    logger.warn({ message: e.message, target: e.target }, 'db.warn');
  });

  return client;
}

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
