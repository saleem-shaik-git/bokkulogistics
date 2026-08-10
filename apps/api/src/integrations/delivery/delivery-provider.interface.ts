/**
 * Delivery provider abstraction (spec: orders NEVER talk to Uber/Bolt
 * directly — only through this interface + the factory).
 *
 * Implementations: MockDeliveryProvider (default, keeps dev and tests
 * fully functional), UberDeliveryProvider / BoltDeliveryProvider (Phase 9,
 * real credentials required — never fake vendor APIs).
 */

export type DeliveryProviderKind = 'MOCK' | 'UBER' | 'BOLT';

/** Geographic point; null coordinates mean "unknown" (mock uses a fallback). */
export interface GeoPoint {
  latitude: number | null;
  longitude: number | null;
}

export interface DeliveryQuoteInput {
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export interface DeliveryQuote {
  quoteId: string;
  provider: DeliveryProviderKind;
  /** Fee in kobo (integer minor units). */
  fee: number;
  currency: 'NGN';
  estimatedMinutes: number;
  distanceKm: number;
  /** ISO timestamp — quotes are only honored while valid. */
  expiresAt: string;
}

/** Courier lifecycle statuses. A delivery is born at REQUESTED — the QUOTE
 *  stage is a pre-delivery artifact represented by DeliveryQuote itself. */
export type DeliveryStatus =
  | 'REQUESTED'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVING'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED';

export interface DeliveryPoint extends GeoPoint {
  address: string;
}

export interface CreateDeliveryInput {
  /** Quote being honored, when one was issued. */
  quoteId?: string;
  /** Our reference for the delivery (order number). */
  reference: string;
  pickup: DeliveryPoint;
  dropoff: DeliveryPoint;
}

export interface CreatedDelivery {
  deliveryId: string;
  status: DeliveryStatus;
  trackingUrl: string | null;
}

export interface DeliveryStatusResult {
  deliveryId: string;
  status: DeliveryStatus;
  trackingUrl: string | null;
}

export interface DeliveryTracking extends DeliveryStatusResult {
  courier: { name: string | null; phone: string | null; vehicle: string | null } | null;
  currentLocation: { latitude: number; longitude: number } | null;
}

/** The provider contract required by the spec. */
export interface DeliveryProvider {
  readonly kind: DeliveryProviderKind;
  getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuote>;
  createDelivery(input: CreateDeliveryInput): Promise<CreatedDelivery>;
  getDeliveryStatus(deliveryId: string): Promise<DeliveryStatusResult>;
  cancelDelivery(deliveryId: string): Promise<DeliveryStatusResult>;
  getTracking(deliveryId: string): Promise<DeliveryTracking>;
}

/** Typed integration failure; `code` surfaces in the API error envelope. */
export class DeliveryIntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryIntegrationError';
  }
}
