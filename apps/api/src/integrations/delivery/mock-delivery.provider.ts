import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  DeliveryIntegrationError,
  type CreatedDelivery,
  type CreateDeliveryInput,
  type DeliveryProvider,
  type DeliveryQuote,
  type DeliveryQuoteInput,
  type DeliveryStatusResult,
  type DeliveryTracking,
  type GeoPoint,
} from './delivery-provider.interface';

/** ₦500 flat dispatch base. */
export const MOCK_BASE_FEE_KOBO = 50_000;
/** ₦150 per started kilometer. */
export const MOCK_PER_KM_FEE_KOBO = 15_000;
/** Used when either endpoint lacks coordinates. */
export const MOCK_FALLBACK_DISTANCE_KM = 5;
export const MOCK_BASE_ETA_MINUTES = 15;
export const MOCK_MINUTES_PER_KM = 4;
export const MOCK_QUOTE_TTL_MINUTES = 15;

/** Haversine great-circle distance, or null when coordinates are missing. */
export function computeDistanceKm(a: GeoPoint, b: GeoPoint): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Deterministic mock provider (default until real Uber/Bolt credentials
 * exist — spec mandates MOCK keeps the whole app functional).
 *
 * Quote math: fee = ₦500 + ₦150 × ceil(km), ETA = 15 + 4 min/km, quotes
 * valid for 15 minutes. The dispatch lifecycle (createDelivery,
 * status/cancel/tracking) is simulated in Phase 9 alongside the
 * deliveries/events tables and the delivery queue.
 */
@Injectable()
export class MockDeliveryProvider implements DeliveryProvider {
  readonly kind = 'MOCK' as const;

  getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuote> {
    const distanceKm = computeDistanceKm(input.pickup, input.dropoff) ?? MOCK_FALLBACK_DISTANCE_KM;
    const wholeKm = Math.ceil(distanceKm);
    return Promise.resolve({
      quoteId: `mockq_${randomUUID()}`,
      provider: this.kind,
      fee: MOCK_BASE_FEE_KOBO + wholeKm * MOCK_PER_KM_FEE_KOBO,
      currency: 'NGN',
      estimatedMinutes: MOCK_BASE_ETA_MINUTES + wholeKm * MOCK_MINUTES_PER_KM,
      distanceKm: Math.round(distanceKm * 10) / 10,
      expiresAt: new Date(Date.now() + MOCK_QUOTE_TTL_MINUTES * 60_000).toISOString(),
    });
  }

  createDelivery(_input: CreateDeliveryInput): Promise<CreatedDelivery> {
    return Promise.reject(this.dispatchPending());
  }

  getDeliveryStatus(_deliveryId: string): Promise<DeliveryStatusResult> {
    return Promise.reject(this.dispatchPending());
  }

  cancelDelivery(_deliveryId: string): Promise<DeliveryStatusResult> {
    return Promise.reject(this.dispatchPending());
  }

  getTracking(_deliveryId: string): Promise<DeliveryTracking> {
    return Promise.reject(this.dispatchPending());
  }

  private dispatchPending(): DeliveryIntegrationError {
    return new DeliveryIntegrationError(
      'DELIVERY_DISPATCH_NOT_IMPLEMENTED',
      'Delivery dispatch is simulated from Phase 9 (deliveries table + events) — ' +
        'the mock provider only issues quotes for now.',
    );
  }
}
