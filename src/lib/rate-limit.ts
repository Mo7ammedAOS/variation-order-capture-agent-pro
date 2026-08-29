import { RateLimitError } from '@/lib/errors';

/**
 * A small fixed-window limiter, in memory.
 *
 * Sufficient for one container: it protects the login form from credential
 * stuffing and the integration routes from a runaway retry loop. It is NOT
 * shared across replicas — when this deployment scales past one container,
 * move the counter to Redis. Documented in SECURITY.md rather than left as a
 * surprise.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    sweep(now);
    return;
  }

  if (existing.count >= options.limit) {
    const seconds = Math.ceil((existing.resetAt - now) / 1000);
    throw new RateLimitError(`Too many attempts. Try again in ${seconds}s.`);
  }

  existing.count += 1;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Drops expired buckets so a long-lived process does not accumulate keys. */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export const LOGIN_RATE_LIMIT: RateLimitOptions = { limit: 8, windowMs: 15 * 60 * 1000 };
export const INTEGRATION_RATE_LIMIT: RateLimitOptions = { limit: 120, windowMs: 60 * 1000 };
