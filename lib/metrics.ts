// Prometheus metrics. One singleton registry; the /api/metrics route reads it.
//
// Convention: histogram durations are in seconds (Prometheus convention). Bucket
// choice spans the realistic range for an interactive web app — 10ms (super
// fast) up to 10s (probably broken).
//
// HMR caveat: Next.js dev server hot-reloads modules, which would trip
// "metric already registered" errors on every change. We stash on globalThis
// so we reuse the same registry across reloads.

import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

type MetricsState = {
  registry: Registry;
  actionDuration: Histogram<'action' | 'status'>;
  actionsTotal: Counter<'action' | 'status'>;
  dbQueryDuration: Histogram<'operation'>;
  authEvents: Counter<'event' | 'provider'>;
  // Business / domain metrics
  sessionsCompleted: Counter;
  setsLogged: Counter;
  templatesUsed: Counter;
  clientErrors: Counter<'kind'>;
};

const globalForMetrics = globalThis as unknown as { _metrics?: MetricsState };

function build(): MetricsState {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'workout_tracker_' });

  const actionDuration = new Histogram({
    name: 'workout_tracker_action_duration_seconds',
    help: 'Duration of server actions, by name and status',
    labelNames: ['action', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });

  const actionsTotal = new Counter({
    name: 'workout_tracker_actions_total',
    help: 'Server actions invoked, by name and status',
    labelNames: ['action', 'status'] as const,
    registers: [registry],
  });

  const dbQueryDuration = new Histogram({
    name: 'workout_tracker_db_query_duration_seconds',
    help: 'Prisma query duration by operation type',
    labelNames: ['operation'] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [registry],
  });

  const authEvents = new Counter({
    name: 'workout_tracker_auth_events_total',
    help: 'Auth.js events by type and provider',
    labelNames: ['event', 'provider'] as const,
    registers: [registry],
  });

  // Business metrics — useful at-a-glance numbers for dashboards
  const sessionsCompleted = new Counter({
    name: 'workout_tracker_sessions_completed_total',
    help: 'Workout sessions marked complete',
    registers: [registry],
  });

  const setsLogged = new Counter({
    name: 'workout_tracker_sets_logged_total',
    help: 'Sets added to a workout (regardless of completion)',
    registers: [registry],
  });

  const templatesUsed = new Counter({
    name: 'workout_tracker_templates_used_total',
    help: 'Workout sessions started from a saved template',
    registers: [registry],
  });

  const clientErrors = new Counter({
    name: 'workout_tracker_client_errors_total',
    help: 'JS errors reported from the browser, by error boundary kind',
    labelNames: ['kind'] as const,
    registers: [registry],
  });

  return {
    registry,
    actionDuration,
    actionsTotal,
    dbQueryDuration,
    authEvents,
    sessionsCompleted,
    setsLogged,
    templatesUsed,
    clientErrors,
  };
}

const state = globalForMetrics._metrics ?? build();
if (process.env.NODE_ENV !== 'production') {
  globalForMetrics._metrics = state;
}

export const metrics = state;
