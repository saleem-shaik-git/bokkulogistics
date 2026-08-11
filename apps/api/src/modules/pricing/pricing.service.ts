import { BadRequestException, Injectable } from '@nestjs/common';
import { SERVICE_FEE_BPS, VAT_BPS } from '@bokku/shared';

export interface PricingInput {
  /** Items subtotal in kobo (from cart lines — DB prices). */
  subtotal: number;
  /** Delivery fee in kobo (from the delivery provider quote). */
  deliveryFee: number;
  /** Discount in kobo (promotions — none in MVP, defaults to 0). */
  discount?: number;
}

export interface PricingBreakdown {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  discount: number;
  total: number;
}

/**
 * The ONE place order totals are computed (server-side authority):
 *
 *   serviceFee = round(subtotal × SERVICE_FEE_BPS / 10_000)   (5%)
 *   tax        = round(subtotal × VAT_BPS / 10_000)           (7.5% VAT)
 *   total      = max(0, subtotal + deliveryFee + serviceFee + tax − discount)
 *
 * Everything is integer kobo; clients only ever display these numbers.
 */
@Injectable()
export class PricingService {
  computeBreakdown(input: PricingInput): PricingBreakdown {
    const { subtotal, deliveryFee } = input;
    const discount = input.discount ?? 0;
    this.assertNonNegativeInteger('subtotal', subtotal);
    this.assertNonNegativeInteger('deliveryFee', deliveryFee);
    this.assertNonNegativeInteger('discount', discount);

    const serviceFee = Math.round((subtotal * SERVICE_FEE_BPS) / 10_000);
    const tax = Math.round((subtotal * VAT_BPS) / 10_000);
    const total = Math.max(0, subtotal + deliveryFee + serviceFee + tax - discount);

    return { subtotal, deliveryFee, serviceFee, tax, discount, total };
  }

  private assertNonNegativeInteger(field: string, value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException({
        code: 'INVALID_PRICING_INPUT',
        message: `${field} must be a non-negative integer number of kobo`,
      });
    }
  }
}
