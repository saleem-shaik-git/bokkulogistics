import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import {
  notificationPreferences,
  notifications,
  storeStaff,
  users,
  type DatabaseConnection,
  type Notification,
  type NotificationPreferences,
} from '@bokku/database';
import type {
  NotificationUnreadCount,
  Paginated,
  PublicNotification,
  PublicNotificationPreferences,
} from '@bokku/shared';

import { DRIZZLE_CLIENT } from '../../config/constants';
import { buildPaginationMeta, parsePagination, type PaginationQuery } from '../../common/pagination';
import type { UpdateNotificationPreferencesDto } from './dto/notifications.dto';

/** What an emitting module hands us — identity is just (userId + type). */
export interface NotificationInput {
  /** Dotted machine type, e.g. "order.paid", "delivery.delivered". */
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Preferences category each type prefix maps to. */
function categoryFor(type: string): 'orderUpdates' | 'paymentUpdates' | 'deliveryUpdates' | null {
  if (type.startsWith('order.') || type.startsWith('store.order')) return 'orderUpdates';
  if (type.startsWith('payment.')) return 'paymentUpdates';
  if (type.startsWith('delivery.')) return 'deliveryUpdates';
  return null; // unknown types always land (internal/system notices)
}

/**
 * In-app notification feed (Phase 11). Emissions honour the recipient's
 * category preferences and NEVER break the caller's flow (failures are
 * logged + swallowed, like the audit module). Reads are owner-scoped —
 * no id from the URL ever crosses accounts.
 *
 * emailEnabled/smsEnabled are stored channel placeholders: nothing sends
 * externally in the MVP (a channel adapter contract can consume them
 * later without a schema change).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  // ── Emission (called by orders/deliveries/bokku flows) ──────────

  async emit(userId: string, input: NotificationInput): Promise<Notification | null> {
    try {
      const prefs = await this.requirePreferences(userId);
      const category = categoryFor(input.type);
      if (category && !prefs[category]) return null;

      const [row] = await this.database.db
        .insert(notifications)
        .values({
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data ?? null,
        })
        .returning();
      return row ?? null;
    } catch (error) {
      this.logger.warn(`Notification emit failed (${input.type} → ${userId})`, error as Error);
      return null;
    }
  }

  /**
   * Fan an event out to a store's ACTIVE staff members
   * (e.g. "new paid order"). PLATFORM_ADMIN is deliberately not
   * included — membership, not role, defines the audience.
   */
  async emitToStoreStaff(storeId: string, input: NotificationInput): Promise<void> {
    try {
      const members = await this.database.db
        .select({ userId: storeStaff.userId })
        .from(storeStaff)
        .innerJoin(users, eq(users.id, storeStaff.userId))
        .where(and(eq(storeStaff.storeId, storeId), eq(users.status, 'ACTIVE')));
      await Promise.all(members.map((member) => this.emit(member.userId, input)));
    } catch (error) {
      this.logger.warn(`Store-staff notification fan-out failed (${input.type})`, error as Error);
    }
  }

  // ── Feed (owner surface) ────────────────────────────────────────

  async listMine(
    userId: string,
    query: PaginationQuery & { unread?: string },
  ): Promise<Paginated<PublicNotification>> {
    const { page, limit, offset } = parsePagination(query);
    const filters: SQL[] = [eq(notifications.userId, userId)];
    if (query.unread === 'true') filters.push(isNull(notifications.readAt));
    const where = and(...filters);

    const [rows, countRows] = await Promise.all([
      this.database.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(notifications).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map((row) => this.toPublic(row)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async unreadCount(userId: string): Promise<NotificationUnreadCount> {
    const [row] = await this.database.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { unread: row?.n ?? 0 };
  }

  /** Idempotent; owner-crossing ids are a clean 404. */
  async markRead(userId: string, id: string): Promise<PublicNotification> {
    const [row] = await this.database.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification was not found',
      });
    }
    if (row.readAt) return this.toPublic(row);

    const [updated] = await this.database.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, row.id))
      .returning();
    return this.toPublic(updated ?? row);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const rows = await this.database.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }

  // ── Preferences ─────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<PublicNotificationPreferences> {
    return this.toPublicPreferences(await this.requirePreferences(userId));
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<PublicNotificationPreferences> {
    await this.requirePreferences(userId); // ensure the row exists
    const patch: Partial<NotificationPreferences> = { updatedAt: new Date() };
    if (dto.orderUpdates !== undefined) patch.orderUpdates = dto.orderUpdates;
    if (dto.paymentUpdates !== undefined) patch.paymentUpdates = dto.paymentUpdates;
    if (dto.deliveryUpdates !== undefined) patch.deliveryUpdates = dto.deliveryUpdates;
    if (dto.marketing !== undefined) patch.marketing = dto.marketing;
    if (dto.emailEnabled !== undefined) patch.emailEnabled = dto.emailEnabled;
    if (dto.smsEnabled !== undefined) patch.smsEnabled = dto.smsEnabled;
    const [updated] = await this.database.db
      .update(notificationPreferences)
      .set(patch)
      .where(eq(notificationPreferences.userId, userId))
      .returning();
    return this.toPublicPreferences(updated!);
  }

  /** Lazily materialise the defaults row on first touch. */
  private async requirePreferences(userId: string): Promise<NotificationPreferences> {
    await this.database.db
      .insert(notificationPreferences)
      .values({ userId })
      .onConflictDoNothing();
    const [row] = await this.database.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    return row!;
  }

  // ── Mapping ─────────────────────────────────────────────────────

  private toPublic(row: Notification): PublicNotification {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: (row.data as Record<string, unknown> | null) ?? null,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toPublicPreferences(row: NotificationPreferences): PublicNotificationPreferences {
    return {
      orderUpdates: row.orderUpdates,
      paymentUpdates: row.paymentUpdates,
      deliveryUpdates: row.deliveryUpdates,
      marketing: row.marketing,
      emailEnabled: row.emailEnabled,
      smsEnabled: row.smsEnabled,
    };
  }
}
