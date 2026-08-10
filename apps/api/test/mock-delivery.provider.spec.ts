import { describe, expect, it } from 'vitest';

import type { CreateDeliveryInput } from '../src/integrations/delivery/delivery-provider.interface';
import {
  deriveMockStatus,
  MockDeliveryProvider,
  mockDeliveryKey,
  MOCK_DELIVERY_SCHEDULE,
  type MockDeliveryRecord,
} from '../src/integrations/delivery/mock-delivery.provider';
import { createFakeRedis } from './fake-redis';

/**
 * The mock courier: a Redis-backed, time-derived lifecycle that keeps the
 * whole app functional (spec). Status is derived from elapsed time, never
 * mutated in place — so every read is deterministic and tests fast-forward
 * by aging the record's dispatchedAt.
 */

const INPUT: CreateDeliveryInput = {
  quoteId: 'mockq_test',
  reference: 'BK-20260810-ABC123',
  pickup: { address: '12 Market Street, Lagos', latitude: 6.5926, longitude: 3.2907 },
  dropoff: { address: '24 Allen Avenue, Ikeja', latitude: 6.6018, longitude: 3.3515 },
};

function ageBy(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

async function ageRecord(redis: ReturnType<typeof createFakeRedis>, id: string, ms: number) {
  const raw = await redis.get(mockDeliveryKey(id));
  const record = JSON.parse(raw!) as MockDeliveryRecord;
  record.dispatchedAt = ageBy(ms);
  await redis.set(mockDeliveryKey(id), JSON.stringify(record));
}

describe('MockDeliveryProvider dispatch lifecycle', () => {
  it('creates a delivery in REQUESTED with a matching record', async () => {
    const redis = createFakeRedis();
    const provider = new MockDeliveryProvider(redis);

    const created = await provider.createDelivery(INPUT);
    expect(created.deliveryId).toMatch(/^mockdel_/);
    expect(created.status).toBe('REQUESTED');
    expect(created.trackingUrl).toBeNull();

    const raw = await redis.get(mockDeliveryKey(created.deliveryId));
    const record = JSON.parse(raw!) as MockDeliveryRecord;
    expect(record.reference).toBe(INPUT.reference);
    expect(record.quoteId).toBe(INPUT.quoteId);
    expect(record.pickup.address).toContain('Market Street');
    expect(record.cancelledAt).toBeNull();

    const status = await provider.getDeliveryStatus(created.deliveryId);
    expect(status.status).toBe('REQUESTED');
  });

  it('walks the schedule DRIVER_ASSIGNED → … → DELIVERED as time passes', async () => {
    const redis = createFakeRedis();
    const provider = new MockDeliveryProvider(redis);
    const { deliveryId } = await provider.createDelivery(INPUT);

    const expectations: Array<[number, string]> = [
      [0, 'REQUESTED'],
      [10_500, 'DRIVER_ASSIGNED'],
      [30_500, 'DRIVER_ARRIVING'],
      [45_500, 'PICKED_UP'],
      [60_500, 'IN_TRANSIT'],
      [130_000, 'DELIVERED'],
    ];
    for (const [ageMs, expected] of expectations) {
      await ageRecord(redis, deliveryId, ageMs);
      const status = await provider.getDeliveryStatus(deliveryId);
      expect(status.status).toBe(expected);
    }
  });

  it('surfaces the courier only from DRIVER_ASSIGNED onwards, with a live position in transit', async () => {
    const redis = createFakeRedis();
    const provider = new MockDeliveryProvider(redis);
    const { deliveryId } = await provider.createDelivery(INPUT);

    const before = await provider.getTracking(deliveryId);
    expect(before.courier).toBeNull();
    expect(before.currentLocation).toBeNull();

    await ageRecord(redis, deliveryId, 11_000);
    const assigned = await provider.getTracking(deliveryId);
    expect(assigned.courier).toMatchObject({ name: expect.any(String), phone: expect.stringMatching(/^\+234/) });
    // Still at the store before pickup.
    expect(assigned.currentLocation).toMatchObject({ latitude: 6.5926, longitude: 3.2907 });

    const pickedAt = MOCK_DELIVERY_SCHEDULE.find((s) => s.status === 'PICKED_UP')!.afterMs;
    const deliveredAt = MOCK_DELIVERY_SCHEDULE.find((s) => s.status === 'DELIVERED')!.afterMs;
    await ageRecord(redis, deliveryId, (pickedAt + deliveredAt) / 2);
    const midTrip = await provider.getTracking(deliveryId);
    expect(midTrip.status).toBe('IN_TRANSIT');
    const loc = midTrip.currentLocation!;
    const f = 0.5;
    expect(loc.latitude).toBeCloseTo(6.5926 + (6.6018 - 6.5926) * f, 1);
    expect(loc.longitude).toBeGreaterThan(3.2907);
    expect(loc.longitude).toBeLessThan(3.3515);
  });

  it('cancels a fresh delivery (idempotently), and refuses once the courier is close', async () => {
    const redis = createFakeRedis();
    const provider = new MockDeliveryProvider(redis);
    const { deliveryId } = await provider.createDelivery(INPUT);

    const cancelled = await provider.cancelDelivery(deliveryId);
    expect(cancelled.status).toBe('CANCELLED');
    // Repeat cancel is a no-op, like a duplicate webhook.
    expect((await provider.cancelDelivery(deliveryId)).status).toBe('CANCELLED');
    expect((await provider.getDeliveryStatus(deliveryId)).status).toBe('CANCELLED');
    // Time does not resurrect it.
    await ageRecord(redis, deliveryId, 130_000);
    expect((await provider.getDeliveryStatus(deliveryId)).status).toBe('CANCELLED');

    const second = await provider.createDelivery(INPUT);
    await ageRecord(redis, second.deliveryId, 31_000); // DRIVER_ARRIVING
    await expect(provider.cancelDelivery(second.deliveryId)).rejects.toMatchObject({
      code: 'DELIVERY_NOT_CANCELLABLE',
    });
  });

  it('404s unknown delivery ids', async () => {
    const provider = new MockDeliveryProvider(createFakeRedis());
    await expect(provider.getDeliveryStatus('mockdel_nope')).rejects.toMatchObject({
      code: 'DELIVERY_NOT_FOUND',
    });
  });
});

describe('deriveMockStatus (pure)', () => {
  it('maps elapsed time to the schedule and honors cancellation first', () => {
    const dispatchedAt = ageBy(61_000);
    expect(deriveMockStatus({ dispatchedAt, cancelledAt: null })).toBe('IN_TRANSIT');
    expect(deriveMockStatus({ dispatchedAt, cancelledAt: ageBy(5) })).toBe('CANCELLED');
    expect(deriveMockStatus({ dispatchedAt: ageBy(9_000), cancelledAt: null })).toBe('REQUESTED');
  });
});
