'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DELIVERY_STATUS_LABELS,
  ORDER_PROGRESS_STEPS,
  ORDER_STATUS_LABELS,
  ORDER_TERMINAL_STATUSES,
  type OrderStatus,
  type PublicDeliveryTracking,
} from '@bokku/shared';

import { useOrder, useOrderTracking } from '@/hooks/use-orders';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Order tracking. Polling-first (spec: no websockets for the MVP) — the
 * query refetches every few seconds until the order reaches a terminal
 * state. The progress rail maps the 12-state machine to the customer-facing
 * journey; cancels/refunds surface on their own panel instead.
 */
export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (hydrated && !user) router.replace(`/login?next=%2Forders%2F${orderId}`);
  }, [hydrated, user, router, orderId]);

  const orderQuery = useOrder(orderId);
  const trackingQuery = useOrderTracking(orderId, orderQuery.data?.status);

  if (!hydrated || !user) {
    return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10 sm:max-w-2xl" />;
  }

  if (orderQuery.isLoading) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10 sm:max-w-2xl">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </main>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center sm:max-w-2xl">
        <h1 className="text-xl font-bold text-slate-900">Order not found</h1>
        <p className="text-sm text-slate-500">
          {orderQuery.error instanceof ApiError && orderQuery.error.status === 404
            ? 'We couldn’t find this order on your account.'
            : 'Something went wrong while loading the order.'}
        </p>
        <Link
          href="/orders"
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Back to my orders
        </Link>
      </main>
    );
  }

  const order = orderQuery.data;
  const cancelled = order.status === 'CANCELLED' || order.status.startsWith('REFUND');
  const currentStep = ORDER_PROGRESS_STEPS.indexOf(order.status);
  const tracking = trackingQuery.data ?? null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8 sm:max-w-2xl">
      <header>
        <Link href="/orders" className="text-sm font-medium text-brand-600 hover:underline">
          ← My orders
        </Link>
        <div className="mt-1 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{order.orderNumber}</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Placed{' '}
              {new Date(order.createdAt).toLocaleString('en-NG', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <span className="text-lg font-bold">{formatKobo(order.total)}</span>
        </div>
      </header>

      {cancelled ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="font-semibold text-slate-800">{ORDER_STATUS_LABELS[order.status]}</p>
          <p className="mt-1 text-sm text-slate-500">
            {order.cancelReason ?? 'This order was cancelled.'}
            {order.status === 'REFUND_PENDING' &&
              ' Your refund is being processed with the payment provider.'}
            {order.status === 'REFUNDED' && ' Your refund has been completed.'}
          </p>
        </section>
      ) : (
        <section
          aria-label="Order progress"
          className="rounded-2xl border border-slate-200 bg-white p-5"
        >
          <ol className="space-y-3">
            {ORDER_PROGRESS_STEPS.map((step, index) => (
              <ProgressStep
                key={step}
                step={step}
                state={
                  index < currentStep ? 'done' : index === currentStep ? 'current' : 'upcoming'
                }
                isLast={index === ORDER_PROGRESS_STEPS.length - 1}
              />
            ))}
          </ol>
          {!ORDER_TERMINAL_STATUSES.includes(order.status) && (
            <p className="mt-4 text-xs text-slate-400">
              Updates automatically as your order progresses.
            </p>
          )}
        </section>
      )}

      {!cancelled && tracking && <CourierCard tracking={tracking} />}

      <section className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">
          Items
        </h2>
        <ul className="divide-y divide-slate-100">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                <p className="text-xs text-slate-400">
                  {item.quantity} × {formatKobo(item.unitPrice)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-slate-900">
                {formatKobo(item.lineTotal)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Delivery to</h2>
        <p className="mt-1 text-sm text-slate-600">
          {order.deliveryAddress.label} — {order.deliveryAddress.street},{' '}
          {order.deliveryAddress.city}, {order.deliveryAddress.state}
        </p>
        <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm">
          <BreakdownRow label="Subtotal" value={formatKobo(order.subtotal)} />
          <BreakdownRow label="Delivery" value={formatKobo(order.deliveryFee)} />
          <BreakdownRow label="Service fee" value={formatKobo(order.serviceFee)} />
          <BreakdownRow label="VAT" value={formatKobo(order.tax)} />
          {order.discount > 0 && (
            <BreakdownRow label="Discount" value={`−${formatKobo(order.discount)}`} />
          )}
          <div className="flex justify-between border-t border-slate-100 pt-2 font-bold text-slate-900">
            <dt>Total</dt>
            <dd>{formatKobo(order.total)}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function ProgressStep({
  step,
  state,
  isLast,
}: {
  step: OrderStatus;
  state: 'done' | 'current' | 'upcoming';
  isLast: boolean;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="relative flex flex-col items-center" aria-hidden>
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            state === 'done'
              ? 'bg-emerald-100 text-emerald-700'
              : state === 'current'
                ? 'bg-brand-600 text-white'
                : 'border border-slate-200 bg-white'
          }`}
        >
          {state === 'done' ? '✓' : state === 'current' ? '●' : ''}
        </span>
        {!isLast && <span className="h-4 w-px bg-slate-200" />}
      </span>
      <p
        className={`pt-0.5 text-sm ${
          state === 'current'
            ? 'font-semibold text-slate-900'
            : state === 'done'
              ? 'text-slate-600'
              : 'text-slate-300'
        }`}
      >
        {ORDER_STATUS_LABELS[step]}
      </p>
    </li>
  );
}

function CourierCard({ tracking }: { tracking: PublicDeliveryTracking }) {
  const delivered = tracking.status === 'DELIVERED';
  const cancelledDelivery = tracking.status === 'CANCELLED';
  // ETA is "minutes from dispatch" on the honored quote — show the remainder.
  const etaRemaining =
    tracking.etaMinutes !== null && !delivered && !cancelledDelivery
      ? Math.max(
          1,
          Math.round(
            tracking.etaMinutes - (Date.now() - new Date(tracking.dispatchedAt).getTime()) / 60_000,
          ),
        )
      : null;

  return (
    <section
      aria-label="Courier tracking"
      className="rounded-2xl border border-brand-100 bg-brand-50 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Courier</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            delivered
              ? 'bg-emerald-100 text-emerald-700'
              : cancelledDelivery
                ? 'bg-slate-200 text-slate-600'
                : 'bg-brand-100 text-brand-700'
          }`}
        >
          {DELIVERY_STATUS_LABELS[tracking.status]}
        </span>
      </div>
      {etaRemaining !== null && (
        <p className="mt-1 text-sm font-medium text-brand-700">Arriving in ~{etaRemaining} min</p>
      )}
      {tracking.courier ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-brand-100 pt-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{tracking.courier.name}</p>
            {tracking.courier.vehicle && (
              <p className="text-xs text-slate-500">{tracking.courier.vehicle}</p>
            )}
          </div>
          {!delivered && !cancelledDelivery && (
            <a
              href={`tel:${tracking.courier.phone}`}
              className="rounded-xl border border-brand-100 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
            >
              Call rider
            </a>
          )}
        </div>
      ) : (
        !cancelledDelivery && (
          <p className="mt-2 text-sm text-slate-500">
            We’re finding a rider near the store — this updates automatically.
          </p>
        )
      )}
      {delivered && tracking.deliveredAt && (
        <p className="mt-2 text-xs text-slate-500">
          Delivered{' '}
          {new Date(tracking.deliveredAt).toLocaleString('en-NG', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      )}
    </section>
  );
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
