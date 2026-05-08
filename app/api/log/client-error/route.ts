// Client-side error sink. Error boundaries POST here so client crashes
// land in the same structured logs as server errors.
//
// Schema is loose on purpose: browsers vary in what they expose. We capture
// what we get, sanity-cap the payload size, and trust the browser's
// origin-based protections to keep this from being a useful target for abuse.

import { logger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import { clientErrorPerIp } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ClientErrorSchema = z.object({
  // 'route' = error.tsx (per-route boundary)
  // 'global' = global-error.tsx (root boundary)
  kind: z.enum(['route', 'global']).default('route'),
  message: z.string().max(2000),
  // Stack might be huge; cap it
  stack: z.string().max(8000).optional(),
  // Next.js production builds give errors a digest; useful to correlate with
  // server-rendered errors that have the same digest.
  digest: z.string().max(200).optional(),
  // Free-form context
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  // Rate limit first — this endpoint is unauthenticated by design (we need to
  // capture errors that prevent a session from working). Without a limiter
  // it could be flooded to fill log volume.
  const ip = await getClientIp();
  const { allowed, retryAfterSec } = clientErrorPerIp.check(ip);
  if (!allowed) {
    return new NextResponse('Too many error reports', {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSec) },
    });
  }

  let parsed: z.infer<typeof ClientErrorSchema>;
  try {
    const body = await request.json();
    parsed = ClientErrorSchema.parse(body);
  } catch {
    // Don't bother logging an error log entry for malformed bodies — could be
    // bots probing the endpoint.
    return new NextResponse('Bad request', { status: 400 });
  }

  // Best-effort userId — don't fail if auth isn't available
  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ?? null;
  } catch {
    // ignore — anonymous error report is fine
  }

  metrics.clientErrors.inc({ kind: parsed.kind });
  logger.error(
    {
      userId,
      ip,
      clientError: parsed,
    },
    'client.error',
  );

  return new NextResponse(null, { status: 204 });
}
