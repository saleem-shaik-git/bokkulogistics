import { describe, expect, it } from 'vitest';
import type { EnvConfig } from '@bokku/config';

import { DeliveryProviderFactory } from '../src/integrations/delivery/delivery-provider.factory';
import { DeliveryIntegrationError } from '../src/integrations/delivery/delivery-provider.interface';
import {
  computeDistanceKm,
  MockDeliveryProvider,
  MOCK_BASE_FEE_KOBO,
  MOCK_FALLBACK_DISTANCE_KM,
  MOCK_PER_KM_FEE_KOBO,
} from '../src/integrations/delivery/mock-delivery.provider';

/**
 * DeliveryProviderFactory chooses the concrete adapter from configuration —
 * the only place vendor selection happens. The mock's quote math is
 * deterministic and pinned here.
 */
describe('DeliveryProviderFactory', () => {
  function factoryWith(provider: string): DeliveryProviderFactory {
    return new DeliveryProviderFactory({ DELIVERY_DEFAULT_PROVIDER: provider } as EnvConfig);
  }

  it('returns the mock provider by default', () => {
    const provider = factoryWith('MOCK').create();
    expect(provider.kind).toBe('MOCK');
    expect(provider).toBeInstanceOf(MockDeliveryProvider);
  });

  it('fails fast for UBER/BOLT until their adapters exist (Phase 9)', () => {
    expect(() => factoryWith('UBER').create()).toThrowError(DeliveryIntegrationError);
    expect(() => factoryWith('UBER').create()).toThrowError(/Phase 9/);
    expect(() => factoryWith('BOLT').create()).toThrowError(/Phase 9/);
  });

  it('fails clearly on an unknown provider value', () => {
    expect(() => factoryWith('LYFT').create()).toThrowError(/Unknown delivery provider/);
  });
});

describe('MockDeliveryProvider quotes', () => {
  const provider = new MockDeliveryProvider();

  it('charges the flat base fee for a zero-distance quote', async () => {
    const point = { latitude: 6.5926, longitude: 3.2907 };
    const quote = await provider.getQuote({ pickup: point, dropoff: point });
    expect(quote.provider).toBe('MOCK');
    expect(quote.fee).toBe(MOCK_BASE_FEE_KOBO);
    expect(quote.currency).toBe('NGN');
    expect(quote.estimatedMinutes).toBe(15);
    expect(quote.distanceKm).toBe(0);
    expect(quote.quoteId).toMatch(/^mockq_/);
    // ~15 minute validity window
    const ttlMs = new Date(quote.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(13 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it('falls back to the default distance when coordinates are missing', async () => {
    const quote = await provider.getQuote({
      pickup: { latitude: null, longitude: null },
      dropoff: { latitude: null, longitude: null },
    });
    expect(quote.distanceKm).toBe(MOCK_FALLBACK_DISTANCE_KM);
    expect(quote.fee).toBe(MOCK_BASE_FEE_KOBO + MOCK_FALLBACK_DISTANCE_KM * MOCK_PER_KM_FEE_KOBO);
  });

  it('scales per started kilometer (1° longitude at the equator)', async () => {
    const quote = await provider.getQuote({
      pickup: { latitude: 0, longitude: 0 },
      dropoff: { latitude: 0, longitude: 1 },
    });
    // ~111.2 km → 112 started kilometres
    expect(quote.fee).toBe(MOCK_BASE_FEE_KOBO + 112 * MOCK_PER_KM_FEE_KOBO);
    expect(quote.estimatedMinutes).toBe(15 + 112 * 4);
  });

  it('treats any unknown coordinate as missing', () => {
    expect(
      computeDistanceKm({ latitude: 6.5, longitude: null }, { latitude: 6.6, longitude: 3.3 }),
    ).toBeNull();
    expect(
      computeDistanceKm({ latitude: 6.5, longitude: 3.2 }, { latitude: 6.5, longitude: 3.2 }),
    ).toBe(0);
  });

  it('keeps the dispatch lifecycle explicitly out of scope until Phase 9', async () => {
    await expect(
      provider.createDelivery({
        reference: 'ORD-1',
        pickup: { latitude: null, longitude: null, address: 'Store' },
        dropoff: { latitude: null, longitude: null, address: 'Home' },
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_DISPATCH_NOT_IMPLEMENTED' });
    await expect(provider.getDeliveryStatus('x')).rejects.toMatchObject({
      code: 'DELIVERY_DISPATCH_NOT_IMPLEMENTED',
    });
    await expect(provider.cancelDelivery('x')).rejects.toMatchObject({
      code: 'DELIVERY_DISPATCH_NOT_IMPLEMENTED',
    });
    await expect(provider.getTracking('x')).rejects.toMatchObject({
      code: 'DELIVERY_DISPATCH_NOT_IMPLEMENTED',
    });
  });
});
