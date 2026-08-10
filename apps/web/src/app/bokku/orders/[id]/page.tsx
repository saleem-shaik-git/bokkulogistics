'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  ORDER_STATUS_LABELS,
  ORDER_TERMINAL_STATUSES,
  type OrderStatus,
} from '@bokku/shared';

import { StatusChip } from '@/components/status-chip';
import {
  OPS_CANCELLABLE,
  OPS_NEXT_STEP,
  useBokkuOrder,
  useTransitionBokkuOrder,
} from '@/hooks/use-bokku';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';

/**
 * Staff order detail: everything needed to work or refund the order.
 * State-policy transitions happen here (and the queue) — cancel runs the
 * full refund path server-side (stock release → provider refund).
 */
export default function BokkuOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderQuery = useBokkuOrder(params.id);
  const transition = useTransitionBokkuOrder();

  const [reason, setReason] = useState('');
  const [actionNote, setActionNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const order = orderQuery.data;

  function runTransition(status: OrderStatus, transitionReason?: string) {
    setActionNote(null);
    transition.mutate(
      { orderId: params.id, status, reason: transitionReason },
      {
        onSuccess: (updated) => {
          setReason('');
          setActionNote({
            tone: 'ok',
            text:
              updated.status === 'REFUNDED'
                ? 'Order cancelled — stock released and the refund completed.'
                : updated.status === 'REFUND_PENDING'
                  ? 'Order cancelled — stock released. The provider refund is pending; keep an eye on it.'
                  : `Order moved to ${ORDER_STATUS_LABELS[updated.status]}.`,
          });
        },
        onError: (err) =>
          setActionNote({
            tone: 'error',
            text: err instanceof ApiError ? err.message : 'The action failed — try again.',
          }),
      },
    );
  }

  if (orderQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (orderQuery.isError || !order) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-red-700">
          {orderQuery.error instanceof ApiError && orderQuery.error.status === 404
            ? 'This order is not part of your store.'
            : 'Couldn’t load the order — try again.'}
        </p>
        <Link href="/bokku/orders" className="mt-3 inline-block text-sm text-brand-600 underline">
          Back to the queue
        </Link>
      </div>
    );
  }

  const next = OPS_NEXT_STEP[order.status];
  const terminal = ORDER_TERMINAL_STATUSES.includes(order.status);
  const progressSteps: OrderStatus[] = [
    'PAID',
    'CONFIRMED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'DELIVERY_REQUESTED',
    'DRIVER_ASSIGNED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ];
  const currentIdx = progressSteps.indexOf(order.status);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/bokku/orders" className="text-sm font-medium text-brand-600 hover:underline">
            ← Queue
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight">{order.orderNumber}</h1>
          <p className="text-xs text-slate-400">
            {new Date(order.createdAt).toLocaleString('en-NG', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
          </p>
        </div>
        <StatusChip status={order.status} />
      </div>

      {actionNote && (
        <p
          role="status"
          className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
            actionNote.tone === 'ok'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {actionNote.text}
        </p>
      )}

      {!terminal && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          {next ? (
            <button
              type="button"
              disabled={transition.isPending}
              onClick={() => runTransition(next.to)}
              className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {transition.isPending ? 'Updating…' : next.label}
            </button>
          ) : (
            <p className="text-sm text-slate-500">
              {order.status === 'READY_FOR_PICKUP'
                ? 'Order is packed — delivery dispatch comes online soon (tracked here).'
                : 'Delivery is in progress and tracked automatically.'}
            </p>
          )}

          {OPS_CANCELLABLE.includes(order.status) && (
            <div id="cancel" className="mt-4 border-t border-slate-100 pt-4">
              <label htmlFor="cancel-reason" className="text-sm font-semibold text-red-700">
                Cancel this order
              </label>
              <p className="mt-0.5 text-xs text-slate-400">
                Releases the reserved stock and refunds the customer through the payment provider.
              </p>
              <textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (e.g. item unavailable, customer requested)"
                rows={2}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-300"
              />
              <button
                type="button"
                disabled={transition.isPending || reason.trim().length < 3}
                onClick={() => runTransition('CANCELLED', reason.trim())}
                className="mt-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {transition.isPending ? 'Cancelling…' : 'Cancel order & refund'}
              </button>
            </div>
          )}
        </section>
      )}

      {!terminal && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Progress">
          <div className="flex flex-wrap items-center gap-1.5">
            {progressSteps.map((step, i) => (
              <span
                key={step}
                title={ORDER_STATUS_LABELS[step]}
                className={`h-1.5 flex-1 rounded-full ${i <= currentIdx ? 'bg-brand-600' : 'bg-slate-100'}`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Currently <span className="font-semibold">{ORDER_STATUS_LABELS[order.status]}</span>
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">Items</h2>
        <ul className="divide-y divide-slate-100">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                <p className="text-xs text-slate-400">
                  {item.sku} · {item.quantity} × {formatKobo(item.unitPrice)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold">{formatKobo(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Delivery</h2>
        <p className="mt-1 text-sm text-slate-600">
          {order.deliveryAddress.label} — {order.deliveryAddress.street},{' '}
          {order.deliveryAddress.city}, {order.deliveryAddress.state}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Quote {order.deliveryQuote.provider} · {order.deliveryQuote.distanceKm.toFixed(1)} km · ~
          {order.deliveryQuote.estimatedMinutes} min
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <dl className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatKobo(order.subtotal)} />
          <Row label="Delivery" value={formatKobo(order.deliveryFee)} />
          <Row label="Service fee" value={formatKobo(order.serviceFee)} />
          <Row label="VAT" value={formatKobo(order.tax)} />
          {order.discount > 0 && <Row label="Discount" value={`−${formatKobo(order.discount)}`} />}
          <div className="flex justify-between border-t border-slate-100 pt-2 font-bold">
            <dt>Total</dt>
            <dd>{formatKobo(order.total)}</dd>
          </div>
          {order.paymentReference && (
            <div className="flex justify-between text-xs text-slate-400">
              <dt>Payment</dt>
              <dd className="font-mono">{order.paymentReference}</dd>
            </div>
          )}
          {order.cancelReason && (
            <div className="flex justify-between gap-4 text-xs text-slate-500">
              <dt>Cancel reason</dt>
              <dd className="text-right">{order.cancelReason}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
