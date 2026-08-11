import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'bokku:rate-limit';

/**
 * Named buckets resolve their per-minute limit from the environment at
 * request time (see RateLimitGuard), so limits are operational knobs —
 * not compile-time constants. `default` needs no decorator at all.
 */
export type RateLimitBucket = 'default' | 'auth' | 'sensitive';

export interface RateLimitOptions {
  bucket: RateLimitBucket;
  /** Explicit override; when omitted the bucket's env limit applies. */
  limit?: number;
  /** Window size in seconds (bucket defaults use 60). */
  windowSeconds?: number;
}

/** Tag a route with a named rate-limit bucket, e.g. `@RateLimit({ bucket: 'auth' })`. */
export function RateLimit(options: RateLimitOptions): CustomDecorator<string> {
  return SetMetadata(RATE_LIMIT_KEY, options);
}
