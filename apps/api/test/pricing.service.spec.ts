import { describe, expect, it } from 'vitest';

import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * PricingService is the single authority for order totals — every input/
 * rounding edge case is pinned down here (all amounts are integer kobo).
 */
describe('PricingService', () => {
  const service = new PricingService();

  it('computes the standard breakdown', () => {
    // subtotal ₦300.00 → fee 5% = ₦15.00, VAT 7.5% = ₦22.50, delivery ₦1,250.00
    expect(service.computeBreakdown({ subtotal: 30_000, deliveryFee: 125_000 })).toEqual({
      subtotal: 30_000,
      deliveryFee: 125_000,
      serviceFee: 1_500,
      tax: 2_250,
      discount: 0,
      total: 158_750,
    });
  });

  it('rounds half-up to whole kobo on fractional percentages', () => {
    // 999 kobo: 5% = 49.95 → 50, 7.5% = 74.925 → 75
    const result = service.computeBreakdown({ subtotal: 999, deliveryFee: 0 });
    expect(result.serviceFee).toBe(50);
    expect(result.tax).toBe(75);
    expect(result.total).toBe(1_124);
  });

  it('handles a zero subtotal without NaNs', () => {
    expect(service.computeBreakdown({ subtotal: 0, deliveryFee: 125_000 })).toEqual({
      subtotal: 0,
      deliveryFee: 125_000,
      serviceFee: 0,
      tax: 0,
      discount: 0,
      total: 125_000,
    });
  });

  it('never lets a discount push the total below zero', () => {
    const result = service.computeBreakdown({
      subtotal: 1_000,
      deliveryFee: 0,
      discount: 100_000,
    });
    expect(result.discount).toBe(100_000);
    expect(result.total).toBe(0);
  });

  it('applies partial discounts normally', () => {
    // 30_000 + 1_500 + 2_250 − 3_000 = 30_750
    const result = service.computeBreakdown({
      subtotal: 30_000,
      deliveryFee: 0,
      discount: 3_000,
    });
    expect(result.total).toBe(30_750);
  });

  it('rejects negative or non-integer inputs', () => {
    expect(() => service.computeBreakdown({ subtotal: -1, deliveryFee: 0 })).toThrowError(
      /subtotal/,
    );
    expect(() => service.computeBreakdown({ subtotal: 100, deliveryFee: 12.5 })).toThrowError(
      /deliveryFee/,
    );
    expect(() =>
      service.computeBreakdown({ subtotal: 100, deliveryFee: 0, discount: -5 }),
    ).toThrowError(/discount/);
  });
});
