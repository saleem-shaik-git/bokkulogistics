import { BadGatewayException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { payments, refunds, type DatabaseConnection, type Payment, type User } from '@bokku/database';
import type { EnvConfig } from '@bokku/config';
import { DRIZZLE_CLIENT, ENV_CONFIG, PAYMENT_PROVIDER } from '../../config/constants';
import { AuditService } from '../audit/audit.module';
import { OrdersService } from '../orders/orders.service';
import { PaymentIntegrationError, type PaymentProvider } from '../../integrations/payments/payment-provider.interface';
import { verifyPaystackSignature } from '../../integrations/payments/paystack-signature';

const ACTIVE = new Set(['REQUESTED', 'PENDING', 'PROCESSING', 'NEEDS_ATTENTION']);
const RANK: Record<string, number> = { REQUESTED: 0, PENDING: 1, PROCESSING: 2, NEEDS_ATTENTION: 3, FAILED: 4, PROCESSED: 5 };
export interface RefundRequestContext { ip?: string; userAgent?: string }

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  async request(payment: Payment): Promise<void> {
    if (payment.status !== 'SUCCESS') throw new ConflictException({ code: 'PAYMENT_NOT_REFUNDABLE', message: `Only successful payments can be refunded (status is ${payment.status})` });
    let [refund] = await this.database.db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).limit(1);
    if (refund?.status === 'PROCESSED' || (refund && ACTIVE.has(refund.status))) return;
    if (!refund) {
      try { [refund] = await this.database.db.insert(refunds).values({ paymentId: payment.id, amount: payment.amount, currency: payment.currency, status: 'REQUESTED' }).returning(); }
      catch (error) { if (!this.isUniqueViolation(error)) throw error; [refund] = await this.database.db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).limit(1); if (refund && (refund.status === 'PROCESSED' || ACTIVE.has(refund.status))) return; }
    } else {
      [refund] = await this.database.db.update(refunds).set({ status: 'REQUESTED', failureReason: null, updatedAt: new Date() }).where(eq(refunds.id, refund.id)).returning();
    }
    try {
      await this.provider.refundPayment({ reference: payment.reference, amount: payment.amount });
      await this.database.db.update(refunds).set({ status: 'PENDING', updatedAt: new Date() }).where(and(eq(refunds.id, refund!.id), eq(refunds.status, 'REQUESTED')));
      await this.audit.record({ action: 'payment.refund_requested', entityType: 'payment', entityId: payment.id, metadata: { reference: payment.reference, amount: payment.amount, provider: payment.provider } });
    } catch (error) {
      const definitive = error instanceof PaymentIntegrationError && error.code === 'PAYMENT_PROVIDER_REJECTED';
      await this.database.db.update(refunds).set({ status: definitive ? 'FAILED' : 'REQUESTED', failureReason: error instanceof Error ? error.message : 'REFUND_REQUEST_FAILED', updatedAt: new Date() }).where(eq(refunds.id, refund!.id));
      throw error;
    }
  }

  async retryOrderRefund(actor: User, orderId: string, context: RefundRequestContext): Promise<Awaited<ReturnType<OrdersService['getAny']>>> {
    const order = await this.orders.getRowById(orderId);
    if (order.status === 'REFUNDED') return this.orders.getAny(orderId);
    if (order.status !== 'REFUND_PENDING') throw new ConflictException({ code: 'ORDER_REFUND_NOT_PENDING', message: `Only orders in REFUND_PENDING can be retried (status is ${order.status})` });
    const [payment] = await this.database.db.select().from(payments).where(eq(payments.id, order.paymentId)).limit(1);
    if (!payment) throw new ConflictException({ code: 'ORDER_REFUND_NOT_PENDING', message: 'This order has no payment on record to refund' });
    const [refund] = await this.database.db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).limit(1);
    if (refund?.status === 'PROCESSED') {
      if (payment.status === 'SUCCESS') await this.database.db.update(payments).set({ status: 'REFUNDED', updatedAt: new Date() }).where(and(eq(payments.id, payment.id), eq(payments.status, 'SUCCESS')));
      return this.orders.transitionSystem(orderId, 'REFUNDED', { reference: payment.reference, refundStatus: 'PROCESSED' });
    }
    try {
      await this.request(payment);
      await this.audit.record({ actorUserId: actor.id, action: 'admin.refund_retried', entityType: 'order', entityId: order.id, metadata: { orderNumber: order.orderNumber, reference: payment.reference }, ipAddress: context.ip, userAgent: context.userAgent });
      return this.orders.getAny(orderId);
    } catch (error) {
      await this.audit.record({ actorUserId: actor.id, action: 'admin.refund_retry_failed', entityType: 'order', entityId: order.id, metadata: { orderNumber: order.orderNumber, reference: payment.reference, reason: error instanceof Error ? error.message : 'REFUND_REQUEST_FAILED' }, ipAddress: context.ip, userAgent: context.userAgent });
      if (error instanceof PaymentIntegrationError) throw new BadGatewayException({ code: error.code, message: error.message });
      throw error;
    }
  }

  async handlePaystackWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: boolean }> {
    const secret = this.env.PAYSTACK_SECRET_KEY;
    if (!secret || !rawBody || !verifyPaystackSignature(rawBody, signature, secret)) return { received: true };
    let event: { event?: unknown; data?: Record<string, unknown> };
    try { event = JSON.parse(rawBody.toString('utf8')) as typeof event; } catch { return { received: true }; }
    if (typeof event.event !== 'string' || !event.event.startsWith('refund.') || typeof event.data?.transaction_reference !== 'string') return { received: true };
    const reference = event.data.transaction_reference;
    const [payment] = await this.database.db.select().from(payments).where(or(eq(payments.reference, reference), eq(payments.providerReference, reference))).limit(1);
    if (!payment) { this.logger.warn(`Ignoring refund webhook for unknown transaction ${reference}`); return { received: true }; }
    const statusMap: Record<string, string> = { 'refund.pending': 'PENDING', 'refund.processing': 'PROCESSING', 'refund.needs-attention': 'NEEDS_ATTENTION', 'refund.failed': 'FAILED', 'refund.processed': 'PROCESSED' };
    const next = statusMap[event.event];
    if (!next) return { received: true };
    const [current] = await this.database.db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).limit(1);
    if (current && RANK[next] < RANK[current.status]) return { received: true };
    const amount = Number(event.data.amount ?? payment.amount);
    const providerReference = typeof event.data.refund_reference === 'string' ? event.data.refund_reference : null;
    if (!current) await this.database.db.insert(refunds).values({ paymentId: payment.id, amount, currency: payment.currency, status: next, providerReference, providerStatus: next, failureReason: next === 'FAILED' ? String(event.data.reason ?? 'PAYSTACK_REFUND_FAILED') : null, processedAt: next === 'PROCESSED' ? new Date() : null });
    else await this.database.db.update(refunds).set({ status: next, providerStatus: next, ...(providerReference ? { providerReference } : {}), ...(next === 'FAILED' ? { failureReason: String(event.data.reason ?? 'PAYSTACK_REFUND_FAILED') } : {}), ...(next === 'PROCESSED' ? { processedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(refunds.id, current.id));
    await this.audit.record({ action: `payment.refund_${next.toLowerCase()}`, entityType: 'payment', entityId: payment.id, metadata: { reference, refundReference: providerReference, providerStatus: next } });
    if (next === 'PROCESSED') {
      const [updated] = await this.database.db.update(payments).set({ status: 'REFUNDED', updatedAt: new Date() }).where(and(eq(payments.id, payment.id), eq(payments.status, 'SUCCESS'))).returning();
      if (updated) await this.audit.record({ action: 'payment.refunded', entityType: 'payment', entityId: payment.id, metadata: { reference, amount: payment.amount, provider: payment.provider } });
      const order = await this.orders.findByPaymentId(payment.id);
      if (order?.status === 'REFUND_PENDING') await this.orders.transitionSystem(order.id, 'REFUNDED', { reference, refundStatus: 'PROCESSED' });
    }
    return { received: true };
  }

  private isUniqueViolation(error: unknown): boolean { let current: unknown = error; while (current && typeof current === 'object') { if ((current as { code?: string }).code === '23505') return true; current = (current as { cause?: unknown }).cause; } return false; }
}
