import type { PublicAddress } from './addresses';

/** Order contracts shared by the API and the web app. */

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DELIVERY_REQUESTED',
  'DRIVER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Terminal states — nothing transitions out of these. */
export const ORDER_TERMINAL_STATUSES: readonly OrderStatus[] = [
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
];

/** Customer-facing progress steps (cancellation/refund shown separately). */
export const ORDER_PROGRESS_STEPS: readonly OrderStatus[] = [
  'PAID',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DELIVERY_REQUESTED',
  'DRIVER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  DELIVERY_REQUESTED: 'Delivery requested',
  DRIVER_ASSIGNED: 'Driver assigned',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
};

/** Delivery quote snapshot stored on the order. */
export interface OrderDeliveryQuote {
  quoteId: string;
  provider: 'MOCK' | 'UBER' | 'BOLT';
  fee: number;
  estimatedMinutes: number;
  distanceKm: number;
  expiresAt: string;
}

export interface PublicOrderItem {
  id: string;
  productId: string;
  /** Snapshot — later product edits never rewrite order history. */
  name: string;
  sku: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface PublicOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: number;
  currency: string;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
}

export interface PublicOrderDetail extends PublicOrderSummary {
  items: PublicOrderItem[];
  deliveryAddress: PublicAddress;
  deliveryQuote: OrderDeliveryQuote;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  discount: number;
  paymentReference: string | null;
  cancelReason: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}
