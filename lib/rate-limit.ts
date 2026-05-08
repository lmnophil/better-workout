// In-memory token-bucket rate limiter.
//
// Why in-memory: zero external dependencies, fits the self-hosted single-instance
// model. State is lost on container restart — that's fine here, since restarts
// are rare and a brief reset doesn't open a meaningful abuse window.
//
// If you ever scale to multiple app instances behind a load balancer, swap the
// internals for a Redis-backed bucket without changing the call sites.

type Bucket = { tokens: number; lastRefill: number };

class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();

  /**
   * @param capacity     Max burst — how many requests allowed back-to-back
   * @param refillPerSec Steady-state rate (e.g., 10/3600 = 10 per hour)
   * @param staleAfterMs After this much idle time, the bucket can be GC'd
   */
  constructor(
    private capacity: number,
    private refillPerSec: number,
    private staleAfterMs: number = 1000 * 60 * 60,
  ) {
    // Periodic cleanup so the map doesn't grow without bound. Don't keep the
    // event loop alive just for this — unref() makes it a non-blocking timer.
    if (typeof setInterval !== 'undefined') {
      const interval = setInterval(() => this.cleanup(), 1000 * 60 * 10);
      interval.unref?.();
    }
  }

  /**
   * Attempt to consume `cost` tokens for `key`. Returns whether the request is
   * allowed and, if not, how many seconds the caller should wait before retrying.
   */
  check(key: string, cost: number = 1): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill based on elapsed time
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastRefill = now;

    if (bucket.tokens < cost) {
      const deficit = cost - bucket.tokens;
      return {
        allowed: false,
        retryAfterSec: Math.ceil(deficit / this.refillPerSec),
      };
    }

    bucket.tokens -= cost;
    return { allowed: true, retryAfterSec: 0 };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      // Only delete fully-refilled (idle) buckets — a partially-drained one
      // still represents recent activity worth tracking.
      const isIdle = now - bucket.lastRefill > this.staleAfterMs;
      const isFull = bucket.tokens >= this.capacity;
      if (isIdle && isFull) this.buckets.delete(key);
    }
  }
}

// ============================================================
// CONFIGURED LIMITERS — tuned for personal/small-group deployment.
// Adjust the numbers if you need stricter or looser limits.
// ============================================================

/**
 * Magic-link sends per IP — broader anti-bot. 10/hour is generous for honest
 * users, tight enough to make abuse expensive.
 */
export const magicLinkPerIp = new TokenBucketLimiter(
  10, // burst
  10 / 3600, // 10 per hour
);

/**
 * Magic-link sends per email — protects a single victim from inbox spam,
 * and protects your Resend quota from being burned on one address.
 * 3/hour is enough that a real user who lost their first email isn't blocked.
 */
export const magicLinkPerEmail = new TokenBucketLimiter(
  3, // burst
  3 / 3600, // 3 per hour
);

/**
 * Client error reports per IP — the /api/log/client-error endpoint is
 * unauthenticated by necessity (we want to capture errors that prevent a
 * normal session). Without a limiter it could be flooded to fill log volume.
 *
 * 30 burst absorbs an error storm from one buggy session; 60/hour steady
 * prevents sustained abuse. A real user genuinely hitting more than 30 errors
 * has bigger problems than missing a few reports.
 */
export const clientErrorPerIp = new TokenBucketLimiter(
  30, // burst
  60 / 3600, // 60 per hour ≈ 1/min
);
