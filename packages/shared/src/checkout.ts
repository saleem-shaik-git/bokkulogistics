import type { PublicAddress } from './addresses';

/**
 * Checkout contracts + the platform pricing policy.
 *
 * The pricing policy constants live HERE (single source of truth): the API's
 * PricingService computes with them and the web app labels its breakdown
 * rows with them — they can never drift apart. All money is integer kobo.
 */

/** Platform operations fee: 5% of the items subtotal, in basis points. */
export const SERVICE_FEE_BPS = 500;
/** Nigerian VAT applied to the items subtotal: 7.5%, in basis points. */
export const VAT_BPS = 750;

/** One purchasable line in a checkout preview (snapshot-free, live prices). */
export interface CheckoutPreviewLine {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

/** The delivery fee quote attached to a preview. */
export interface CheckoutQuote {
  quoteId: string;
  provider: 'MOCK' | 'UBER' | 'BOLT';
  /** Delivery fee in kobo. */
  fee: number;
  estimatedMinutes: number;
  distanceKm: number;
  /** ISO timestamp — quotes are only honored until they expire. */
  expiresAt: string;
}

/**
 * Full server-computed checkout preview:
 *   total = subtotal + deliveryFee + serviceFee + tax − discount (≥ 0).
 * Nothing here comes from the client except the cart contents and the
 * chosen address id.
 */
export interface CheckoutPreview {
  cartId: string;
  storeId: string;
  address: PublicAddress;
  lines: CheckoutPreviewLine[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  discount: number;
  total: number;
  quote: CheckoutQuote;
}
