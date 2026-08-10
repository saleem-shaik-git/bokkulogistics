import type { OrderStatus } from './orders';

/**
 * Bokku operations dashboard contracts — the staff-facing surface.
 * Money stays integer kobo, exactly like the customer-facing contracts.
 */

export type OpsProductStatus = 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK' | 'DRAFT';

/** Product row as exposed to store staff (soft-deleted rows never appear). */
export interface OpsProduct {
  id: string;
  storeId: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  price: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  status: OpsProductStatus;
  createdAt: string;
  updatedAt: string;
}

/** Stock levels for one product, with the computed sellable/flag fields. */
export interface OpsInventoryRow {
  productId: string;
  productName: string;
  sku: string;
  quantityOnHand: number;
  reservedQuantity: number;
  sellable: number;
  lowStockThreshold: number;
  /** on hand at or below the product's threshold (out-of-stock included). */
  lowStock: boolean;
}

export interface OpsDashboardSummary {
  store: { id: string; name: string; code: string };
  /** Orders created today (UTC calendar day), any status. */
  todayOrders: number;
  /** Sum of totals paid today (UTC), excluding cancel/refund states (kobo). */
  todayRevenue: number;
  /** Paid-and-not-yet-terminal work: PAID → OUT_FOR_DELIVERY. */
  pendingFulfillment: number;
  outForDelivery: number;
  /** All-time counts per status (only statuses with ≥1 order appear). */
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  /** Low-stock but not yet empty (sellable still above zero). */
  lowStockCount: number;
  outOfStockCount: number;
  /** Worst first (sellable asc, then name) — quick action list, max 5. */
  lowStockAlerts: OpsInventoryRow[];
}
