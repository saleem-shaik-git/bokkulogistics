import { randomInt, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../config/constants';
import {
  DeliveryIntegrationError,
  type CreatedDelivery,
  type CreateDeliveryInput,
  type DeliveryPoint,
  type DeliveryProvider,
  type DeliveryQuote,
  type DeliveryQuoteInput,
  type DeliveryStatus,
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

/**
 * Simulated courier lifecycle after dispatch: status is DERIVED from the
 * elapsed time (deterministic — tests and every app instance agree).
 * Full journey ≈ 2 minutes, tuned for demo polling; tests fast-forward by
 * rewriting `dispatchedAt` in the record.
 */
export const MOCK_DELIVERY_SCHEDULE: ReadonlyArray<{
  status: Exclude<DeliveryStatus, 'REQUESTED' | 'CANCELLED'>;
  afterMs: number;
}> = [
  { status: 'DRIVER_ASSIGNED', afterMs: 10_000 },
  { status: 'DRIVER_ARRIVING', afterMs: 30_000 },
  { status: 'PICKED_UP', afterMs: 45_000 },
  { status: 'IN_TRANSIT', afterMs: 60_000 },
  { status: 'DELIVERED', afterMs: 120_000 },
];

/** The courier only accepts a cancellation before reaching the store. */
export const MOCK_CANCELLABLE_STATUSES: readonly DeliveryStatus[] = [
  'REQUESTED',
  'DRIVER_ASSIGNED',
];

const RECORD_TTL_SECONDS = 24 * 60 * 60;

interface MockCourier {
  name: string;
  phone: string;
  vehicle: string;
}

const COURIER_POOL: readonly MockCourier[] = [
  { name: 'Emeka Obi', phone: '+2348031000001', vehicle: 'Bike · LAG KJA 432XA' },
  { name: 'Aisha Bello', phone: '+2348031000002', vehicle: 'Bike · LAG TUY 891BB' },
  { name: 'Tunde Adeyemi', phone: '+2348031000003', vehicle: 'Bike · LAG QRS 217CC' },
];

export interface MockDeliveryRecord {
  deliveryId: string;
  reference: string;
  quoteId: string | null;
  pickup: DeliveryPoint;
  dropoff: DeliveryPoint;
  courier: MockCourier;
  dispatchedAt: string;
  cancelledAt: string | null;
}

export function mockDeliveryKey(deliveryId: string): string {
  return `mockdel:${deliveryId}`;
}

/**
 * Derived lifecycle status — a record never "moves", only time does,
 * which makes every read deterministic and idempotent (spec: polling-first).
 */
export function deriveMockStatus(
  record: Pick<MockDeliveryRecord, 'dispatchedAt' | 'cancelledAt'>,
  now: Date = new Date(),
): DeliveryStatus {
  if (record.cancelledAt) return 'CANCELLED';
  const elapsed = now.getTime() - new Date(record.dispatchedAt).getTime();
  let current: DeliveryStatus = 'REQUESTED';
  for (const stage of MOCK_DELIVERY_SCHEDULE) {
    if (elapsed >= stage.afterMs) current = stage.status;
  }
  return current;
}

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
 * valid 15 minutes. Dispatch is simulated in Redis: createDelivery stores
 * the record; status/cancel/tracking derive from the schedule above.
 */
@Injectable()
export class MockDeliveryProvider implements DeliveryProvider {
  readonly kind = 'MOCK' as const;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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

  async createDelivery(input: CreateDeliveryInput): Promise<CreatedDelivery> {
    const deliveryId = `mockdel_${randomUUID()}`;
    const record: MockDeliveryRecord = {
      deliveryId,
      reference: input.reference,
      quoteId: input.quoteId ?? null,
      pickup: input.pickup,
      dropoff: input.dropoff,
      courier: COURIER_POOL[randomInt(COURIER_POOL.length)]!,
      dispatchedAt: new Date().toISOString(),
      cancelledAt: null,
    };
    await this.redis.set(mockDeliveryKey(deliveryId), JSON.stringify(record), 'EX', RECORD_TTL_SECONDS);
    return { deliveryId, status: 'REQUESTED', trackingUrl: null };
  }

  async getDeliveryStatus(deliveryId: string): Promise<DeliveryStatusResult> {
    const record = await this.requireRecord(deliveryId);
    return { deliveryId, status: deriveMockStatus(record), trackingUrl: null };
  }

  async cancelDelivery(deliveryId: string): Promise<DeliveryStatusResult> {
    const record = await this.requireRecord(deliveryId);
    const status = deriveMockStatus(record);
    if (status === 'CANCELLED') {
      return { deliveryId, status: 'CANCELLED', trackingUrl: null }; // idempotent
    }
    if (!MOCK_CANCELLABLE_STATUSES.includes(status)) {
      throw new DeliveryIntegrationError(
        'DELIVERY_NOT_CANCELLABLE',
        `The mock courier cannot be cancelled while ${status.toLowerCase().replace('_', ' ')} — ` +
          'only before reaching the store',
      );
    }
    record.cancelledAt = new Date().toISOString();
    await this.redis.set(mockDeliveryKey(deliveryId), JSON.stringify(record), 'EX', RECORD_TTL_SECONDS);
    return { deliveryId, status: 'CANCELLED', trackingUrl: null };
  }

  async getTracking(deliveryId: string): Promise<DeliveryTracking> {
    const record = await this.requireRecord(deliveryId);
    const status = deriveMockStatus(record);
    const assigned = !['REQUESTED', 'CANCELLED'].includes(status);
    return {
      deliveryId,
      status,
      trackingUrl: null,
      courier: assigned
        ? {
            name: record.courier.name,
            phone: record.courier.phone,
            vehicle: record.courier.vehicle,
          }
        : null,
      currentLocation: assigned ? this.interpolateLocation(record, status) : null,
    };
  }

  /** Linear position between pickup and dropoff while on the road. */
  private interpolateLocation(
    record: MockDeliveryRecord,
    status: DeliveryStatus,
  ): { latitude: number; longitude: number } | null {
    const { pickup, dropoff } = record;
    if (
      pickup.latitude == null ||
      pickup.longitude == null ||
      dropoff.latitude == null ||
      dropoff.longitude == null
    ) {
      return null;
    }
    const elapsed = new Date().getTime() - new Date(record.dispatchedAt).getTime();
    const picked = MOCK_DELIVERY_SCHEDULE.find((s) => s.status === 'PICKED_UP')!.afterMs;
    const arrived = MOCK_DELIVERY_SCHEDULE.find((s) => s.status === 'DELIVERED')!.afterMs;
    let fraction = 0;
    if (status === 'DELIVERED') fraction = 1;
    else if (status === 'PICKED_UP' || status === 'IN_TRANSIT') {
      fraction = Math.min(1, Math.max(0, (elapsed - picked) / (arrived - picked)));
    }
    return {
      latitude: pickup.latitude + (dropoff.latitude - pickup.latitude) * fraction,
      longitude: pickup.longitude + (dropoff.longitude - pickup.longitude) * fraction,
    };
  }

  private async requireRecord(deliveryId: string): Promise<MockDeliveryRecord> {
    const raw = await this.redis.get(mockDeliveryKey(deliveryId));
    if (!raw) {
      throw new DeliveryIntegrationError(
        'DELIVERY_NOT_FOUND',
        `Mock delivery ${deliveryId} was not found`,
      );
    }
    return JSON.parse(raw) as MockDeliveryRecord;
  }
}
