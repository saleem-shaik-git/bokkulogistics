import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paystack webhook signature verification: HMAC-SHA512 of the RAW request
 * body with the secret key, compared in constant time. The raw body is
 * mandatory — hashing a re-serialized payload is broken by design.
 */
export function verifyPaystackSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secretKey: string,
): boolean {
  if (!signature) return false;
  const computed = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
