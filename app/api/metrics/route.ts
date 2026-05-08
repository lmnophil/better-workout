// Prometheus metrics endpoint.
//
// Protected by METRICS_TOKEN — set this in .env to a long random string and
// configure your scraper (Prometheus, Grafana Agent, etc.) to send it as a
// Bearer token. Without the env var set, the endpoint is closed.
//
// Scrape config example for Prometheus:
//
//   scrape_configs:
//     - job_name: workout-tracker
//       authorization:
//         credentials: <METRICS_TOKEN>
//       static_configs:
//         - targets: ['workout.example.com']
//       metrics_path: /api/metrics

import { metrics } from '@/lib/metrics';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

// Metrics endpoint behavior should be runtime-driven — never statically cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    // Fail closed if the operator hasn't configured a token. Better than
    // accidentally exposing internal counters publicly.
    logger.warn({}, 'metrics.endpoint_disabled_no_token');
    return new NextResponse('Metrics endpoint not configured', { status: 503 });
  }

  // Accept either Authorization: Bearer <token> or ?token= query param
  const auth = request.headers.get('authorization');
  const headerToken = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  const queryToken = new URL(request.url).searchParams.get('token');
  const provided = headerToken ?? queryToken;

  if (provided !== expected) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await metrics.registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': metrics.registry.contentType },
  });
}
