import type { OrderDeliveryQuote } from './orders';

/**
 * Delivery tracking contracts shared by the API and the web app
 * (spec: customers poll the courier state — no websockets in the MVP).
 */

export const DELIVERY_STATUSES = [
  'REQUESTED',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_TERMINAL_STATUSES: readonly DeliveryStatus[] = ['DELIVERED', 'CANCELLED'];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  REQUESTED: 'Finding a rider',
  DRIVER_ASSIGNED: 'Rider assigned',
  DRIVER_ARRIVING: 'Rider arriving at store',
  PICKED_UP: 'Parcel picked up',
  IN_TRANSIT: 'On the way to you',
  DELIVERED: 'Delivered',
  CANCELLED: 'Delivery cancelled',
};

/** Courier details — surfaced only from DRIVER_ASSIGNED onwards. */
export interface PublicCourier {
  name: string;
  phone: string;
  vehicle: string | null;
}

/** Wire shape of GET /orders/:id/tracking. */
export interface PublicDeliveryTracking {
  orderId: string;
  externalId: string;
  provider: OrderDeliveryQuote['provider'];
  status: DeliveryStatus;
  courier: PublicCourier | null;
  /** ETA in minutes from dispatch (from the honored quote). */
  etaMinutes: number | null;
  dispatchedAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
}
