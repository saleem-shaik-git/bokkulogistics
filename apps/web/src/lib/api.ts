import type { HealthCheckResult } from '@bokku/shared';

/**
 * Client-side API helpers. The browser only ever talks to same-origin
 * Next.js route handlers (e.g. /api/health); those handlers proxy to the
 * NestJS API server-side so no internal URLs or secrets reach the client.
 */
export async function fetchHealth(): Promise<HealthCheckResult> {
  const res = await fetch('/api/health', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`);
  }
  return (await res.json()) as HealthCheckResult;
}
