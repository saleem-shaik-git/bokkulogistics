import { randomUUID } from 'node:crypto';

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { payments, type DatabaseConnection, type Payment } from '@bokku/database';
import type { EnvConfig } from '@bokku/config';
import {
  PAYMENT_REFERENCE_PREFIX,
  type InitializePaymentResult,
  type PaymentSummary,
} from '@bokku/shared';
import type { User } from '@bokku/database';

import { DRIZZLE_CLIENT, ENV_CONFIG, PAYMENT_PROVIDER } from '../../config/constants';
import { AuditService } from '../audit/audit.module';
import { CheckoutService } from '../checkout/checkout.service';
import { MockPaymentProvider } from '../../integrations/payments/mock-payment.provider';
import {
  PaymentIntegrationError,
  type PaymentProvider,
} from '../../integrations/payments/payment-provider.interface';
import { verifyPaystackSignature } from '../../integrations/payments/paystack-signature';
import type { InitializePaymentDto, MockCompletePaymentDto } from './dto/payments.dto';

/** Breakdown + order inputs snapshotted at initialize time (consumed in Phase 7). */
interface PaymentMetadata {
  cartId: string;
  storeId: string;
  addressId: string;
  addressSnapshot: Record<string, unknown>;
  quote: Record<string, unknown>;
  breakdown: Record<string, number>;
  lines: Array<Record<string, unknown>>;
}

/**
 * Payments. The trust model (spec): amounts come only from server-side
 * computation; confirmation comes only from server-side verification with
 * the provider (webhook → verify, or the same verify on demand).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly mockProvider: MockPaymentProvider,
    private readonly checkout: CheckoutService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Initialize (or idempotently resume) a payment for the caller's cart.
   * The preview is recomputed NOW — totals are always fresh server data.
   */
  async initialize(
    user: User,
    dto: InitializePaymentDto,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<InitializePaymentResult> {
    // Validates cart non-empty, line availability and address ownership;
    // computes the full server breakdown (throws shared error codes).
    const preview = await this.checkout.preview(user.id, { addressId: dto.addressId });

    const paid = await this.database.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.cartId, preview.cartId), eq(payments.status, 'SUCCESS')))
      .limit(1);
    if (paid.length > 0) {
      throw new ConflictException({
        code: 'CART_ALREADY_PAID',
        message: 'This cart has already been paid for',
      });
    }

    const pending = await this.findPendingForCart(preview.cartId);
    let payment: Payment | null = null;

    if (pending && pending.amount === preview.total) {
      // Idempotent retry of the SAME amount — reuse the existing transaction.
      payment = pending;
    } else {
      payment = await this.replacePendingTransaction(user, pending, preview, context);
    }

    if (!payment.authorizationUrl) {
      // Provider session was not established yet (fresh row or earlier
      // provider outage) — create it now and persist for future retries.
      try {
        const session = await this.provider.initializePayment({
          reference: payment.reference,
          amount: payment.amount,
          currency: 'NGN',
          email: user.email,
          callbackUrl:
            dto.callbackUrl ?? `${this.env.APP_URL}/payment/result?reference=${payment.reference}`,
          metadata: { reference: payment.reference, cartId: preview.cartId },
        });
        const [updated] = await this.database.db
          .update(payments)
          .set({
            authorizationUrl: session.authorizationUrl,
            providerReference: session.providerReference ?? payment.providerReference,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, payment!.id))
          .returning();
        payment = updated ?? payment;
      } catch (error) {
        throw this.mapProviderError(error);
      }
    }

    return { ...this.toSummary(payment), authorizationUrl: payment.authorizationUrl! };
  }

  /** Abandon a stale pending row (amount changed) and create a fresh one — atomically. */
  private async replacePendingTransaction(
    user: User,
    stale: Payment | null,
    preview: Awaited<ReturnType<CheckoutService['preview']>>,
    context: { ip?: string; userAgent?: string },
  ): Promise<Payment> {
    const reference = `${PAYMENT_REFERENCE_PREFIX}${randomUUID().replaceAll('-', '')}`;
    const metadata: PaymentMetadata = {
      cartId: preview.cartId,
      storeId: preview.storeId,
      addressId: preview.address.id,
      addressSnapshot: { ...preview.address },
      quote: { ...preview.quote },
      breakdown: {
        subtotal: preview.subtotal,
        deliveryFee: preview.deliveryFee,
        serviceFee: preview.serviceFee,
        tax: preview.tax,
        discount: preview.discount,
        total: preview.total,
      },
      lines: preview.lines.map((line) => ({ ...line })),
    };

    try {
      return await this.database.db.transaction(async (tx) => {
        if (stale) {
          await tx
            .update(payments)
            .set({
              status: 'ABANDONED',
              failureReason: 'CART_TOTAL_CHANGED',
              updatedAt: new Date(),
            })
            .where(eq(payments.id, stale.id));
        }
        const [created] = await tx
          .insert(payments)
          .values({
            userId: user.id,
            cartId: preview.cartId,
            addressId: preview.address.id,
            storeId: preview.storeId,
            reference,
            provider: this.provider.kind,
            status: 'PENDING',
            amount: preview.total,
            currency: 'NGN',
            email: user.email,
            metadata: JSON.parse(JSON.stringify(metadata)),
          })
          .returning();

        await this.audit.record({
          actorUserId: user.id,
          action: 'payment.initialized',
          entityType: 'payment',
          entityId: created!.id,
          metadata: {
            reference,
            amount: preview.total,
            provider: this.provider.kind,
            ...(stale ? { replaces: stale.reference } : {}),
          },
          ipAddress: context.ip,
          userAgent: context.userAgent,
        });
        return created!;
      });
    } catch (error) {
      // Concurrent initialize for the same cart hit the one-pending-per-cart
      // unique index — the winner's row is the correct one to reuse.
      if (this.isUniqueViolation(error)) {
        const winner = await this.findPendingForCart(preview.cartId);
        if (winner && winner.amount === preview.total) return winner;
      }
      throw error;
    }
  }

  /** Owner-scoped payment lookup; a PENDING row is re-verified server-side (poll fallback). */
  async getByReferenceForUser(userId: string, reference: string): Promise<PaymentSummary> {
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(and(eq(payments.reference, reference), eq(payments.userId, userId)))
      .limit(1);
    if (!payment) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment was not found' });
    }
    if (payment.status === 'PENDING') {
      const confirmed = await this.confirmFromProvider(reference);
      return this.toSummary(confirmed ?? payment);
    }
    return this.toSummary(payment);
  }

  /**
   * THE idempotent confirmation path — driven by the Paystack webhook, by
   * polling fallbacks, and (in dev) by the mock checkout simulator. Safe
   * against duplicate calls: a settled payment is returned untouched.
   */
  async confirmFromProvider(reference: string): Promise<Payment | null> {
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.reference, reference))
      .limit(1);
    if (!payment) return null; // unknown reference — acknowledged by callers
    if (payment.status !== 'PENDING') return payment; // duplicate delivery — no-op

    const verified = await this.provider.verifyPayment(reference).catch((error: unknown) => {
      throw this.mapProviderError(error);
    });

    if (!verified.paid) {
      if (verified.rawStatus === 'failed' || verified.rawStatus === 'abandoned') {
        const [failed] = await this.database.db
          .update(payments)
          .set({
            status: 'FAILED',
            failureReason: verified.rawStatus.toUpperCase(),
            channel: verified.channel,
            updatedAt: new Date(),
          })
          .where(and(eq(payments.id, payment.id), eq(payments.status, 'PENDING')))
          .returning();
        if (failed) {
          await this.audit.record({
            action: 'payment.failed',
            entityType: 'payment',
            entityId: payment.id,
            metadata: { reference, reason: verified.rawStatus, provider: payment.provider },
          });
        }
        return failed ?? payment;
      }
      return payment; // still pending provider-side
    }

    // Amount integrity: the provider must confirm EXACTLY our server amount.
    if (verified.amount !== payment.amount) {
      const [mismatch] = await this.database.db
        .update(payments)
        .set({
          status: 'FAILED',
          failureReason: 'AMOUNT_MISMATCH',
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, payment.id), eq(payments.status, 'PENDING')))
        .returning();
      await this.audit.record({
        action: 'payment.amount_mismatch',
        entityType: 'payment',
        entityId: payment.id,
        metadata: { reference, expected: payment.amount, providerAmount: verified.amount },
      });
      this.logger.error(
        `Amount mismatch for ${reference}: expected ${payment.amount}, provider said ${verified.amount}`,
      );
      return mismatch ?? payment;
    }

    const [succeeded] = await this.database.db
      .update(payments)
      .set({
        status: 'SUCCESS',
        paidAt: verified.paidAt ? new Date(verified.paidAt) : new Date(),
        channel: verified.channel,
        providerReference: verified.providerReference ?? payment.providerReference,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'PENDING')))
      .returning();

    if (succeeded) {
      // Only the row that actually transitioned audits — duplicates that
      // raced see status≠PENDING above and never reach here.
      await this.audit.record({
        action: 'payment.succeeded',
        entityType: 'payment',
        entityId: payment.id,
        metadata: { reference, amount: payment.amount, channel: verified.channel },
      });
    }
    return succeeded ?? payment;
  }

  /** Paystack webhook entry point (public): signature-verified, then the standard confirm path. */
  async handlePaystackWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const secret = this.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      await this.audit.record({
        action: 'payment.webhook_rejected',
        metadata: { reason: 'no_secret_configured' },
      });
      throw new UnauthorizedException({
        code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED',
        message: 'Webhook secret is not configured',
      });
    }
    if (!rawBody || !verifyPaystackSignature(rawBody, signature, secret)) {
      await this.audit.record({
        action: 'payment.webhook_rejected',
        metadata: { reason: 'invalid_signature' },
      });
      throw new UnauthorizedException({
        code: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid webhook signature',
      });
    }

    let event: { event?: unknown; data?: { reference?: unknown } };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw new BadRequestException({
        code: 'PAYMENT_WEBHOOK_INVALID_PAYLOAD',
        message: 'Webhook payload is not valid JSON',
      });
    }

    // Only charge.success changes state; every other event is acknowledged
    // and ignored (provider retries are thus harmless, duplicates included).
    if (event.event === 'charge.success' && typeof event.data?.reference === 'string') {
      await this.confirmFromProvider(event.data.reference);
    }
    return { received: true };
  }

  /**
   * Dev/test-only mock checkout completion (hidden outside the mock provider
   * and in production): records the simulated outcome, then runs the very
   * same confirmation path a real webhook would.
   */
  async mockComplete(dto: MockCompletePaymentDto): Promise<PaymentSummary> {
    if (this.env.NODE_ENV === 'production' || this.provider.kind !== 'MOCK') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.reference, dto.reference))
      .limit(1);
    if (!payment || payment.provider !== 'MOCK') {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment was not found' });
    }

    await this.mockProvider.simulateOutcome(dto.reference, dto.outcome, payment.amount);
    const settled = await this.confirmFromProvider(dto.reference);
    return this.toSummary(settled ?? payment);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private async findPendingForCart(cartId: string): Promise<Payment | null> {
    const [pending] = await this.database.db
      .select()
      .from(payments)
      .where(and(eq(payments.cartId, cartId), eq(payments.status, 'PENDING')))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return pending ?? null;
  }

  /** Map integration errors to 502s while preserving their machine codes. */
  private mapProviderError(error: unknown): Error {
    if (error instanceof PaymentIntegrationError) {
      return new BadGatewayException({ code: error.code, message: error.message });
    }
    return error as Error;
  }

  /** Wrapped driver errors keep the PG code on the cause chain. */
  private isUniqueViolation(error: unknown): boolean {
    let current: unknown = error;
    while (current && typeof current === 'object') {
      if ((current as { code?: string }).code === '23505') return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }

  toSummary(payment: Payment): PaymentSummary {
    return {
      reference: payment.reference,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      channel: payment.channel,
      failureReason: payment.failureReason,
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    };
  }
}
