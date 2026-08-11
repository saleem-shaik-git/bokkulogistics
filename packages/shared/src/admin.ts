import type { EntityStatus, UserRole } from './index';
import type { DeliveryStatus } from './delivery';
import type { OrderStatus } from './orders';

/**
 * Platform admin contracts (Phase 10). PLATFORM_ADMIN-only surfaces for
 * platform-wide oversight: metrics, user management, store oversight,
 * cross-store orders and the audit trail. Money stays integer kobo.
 */

export interface AdminDashboardSummary {
  /** Orders created today (UTC calendar day), any status. */
  todayOrders: number;
  /** Sum of totals paid today, excluding cancel/refund states (kobo). */
  todayRevenue: number;
  allTimeOrders: number;
  /** Sum of totals for paid orders not cancelled/refunded (kobo). */
  allTimeRevenue: number;
  /** All-time counts per order status (only statuses with ≥1 order). */
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  /** Deliveries not yet DELIVERED/CANCELLED (provider-side view). */
  activeDeliveries: number;
  deliveriesByStatus: Partial<Record<DeliveryStatus, number>>;
  totalUsers: number;
  usersByRole: Partial<Record<UserRole, number>>;
  newUsersToday: number;
  suspendedUsers: number;
  totalStores: number;
  activeStores: number;
}

export interface AdminStoreRow {
  id: string;
  name: string;
  code: string;
  status: EntityStatus;
  city: string;
  state: string;
  staffCount: number;
  productCount: number;
  totalOrders: number;
  todayOrders: number;
  /** Paid today, excluding cancel/refund states (kobo). */
  todayRevenue: number;
  createdAt: string;
}

/** Actor summary on an audit row (null for anonymous/system actions). */
export interface AdminAuditActor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: AdminAuditActor | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
