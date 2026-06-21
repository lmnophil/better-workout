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

import { createHash, timingSafeEqual } from 'node:crypto';
import { metrics } from '@/lib/metrics';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

// Metrics endpoint behavior should be runtime-driven — never statically cached.
export const dynamic = 'force-dynamic';

// Belt-and-suspenders against intermediate caches (PWA service worker, CDN,
// browser back/forward cache). `force-dynamic` keeps Next from caching its
// own response; `no-store` keeps everything downstream honest. The scraped
// values are sensitive operator data and would also go stale instantly.
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

// Constant-time token check. Hash both sides to a fixed-width digest first so
// timingSafeEqual never sees mismatched lengths (it throws on those) and the
// token's length can't leak through comparison timing.
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    // Fail closed if the operator hasn't configured a token. Better than
    // accidentally exposing internal counters publicly.
    logger.warn({}, 'metrics.endpoint_disabled_no_token');
    return new NextResponse('Metrics endpoint not configured', {
      status: 503,
      headers: NO_STORE,
    });
  }

  // Authorization: Bearer <token> only. We deliberately don't accept a ?token=
  // query param: query strings land in proxy access logs and Referer headers,
  // which would leak the credential.
  const auth = request.headers.get('authorization');
  const provided = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;

  if (!provided || !tokenMatches(provided, expected)) {
    return new NextResponse('Forbidden', { status: 403, headers: NO_STORE });
  }

  const body = await metrics.registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': metrics.registry.contentType,
      ...NO_STORE,
    },
  });
}
