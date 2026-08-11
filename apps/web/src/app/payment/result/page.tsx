'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
import { usePlaceOrder } from '@/hooks/use-orders';
import { fetchPayment } from '@/lib/payments-api';
import { formatKobo } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Post-payment landing page (the provider's callback target for real
 * Paystack too). Polls the owner-scoped payment endpoint — which itself
 * re-verifies PENDING payments server-side — until the webhook/provider
 * confirmation lands, then shows the outcome. Never trusts the redirect.
 */
export default function PaymentResultPage() {
  return (
    <Suspense>
      <PaymentResultContent />
    </Suspense>
  );
}

function PaymentResultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=%2Fcheckout');
  }, [hydrated, user, router]);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const query = useQuery({
    queryKey: ['payment', reference],
    queryFn: () => fetchPayment(reference!),
    enabled: !!user && !!reference,
    refetchInterval: (q) =>
      q.state.data?.status === 'PENDING' && !timedOut ? POLL_INTERVAL_MS : false,
  });

  const payment = query.data;

  // Payment confirmed ⇒ place the order exactly once. Server-side the
  // conversion is idempotent (one order per payment), and the payment
  // confirmation itself already auto-converted, so this normally just
  // fetches the freshly created order.
  const placeOrder = usePlaceOrder();
  const placeOrderRef = useRef(placeOrder.mutate);
  placeOrderRef.current = placeOrder.mutate;
  const [placedFor, setPlacedFor] = useState<string | null>(null);
  useEffect(() => {
    if (payment?.status === 'SUCCESS' && placedFor !== payment.reference) {
      setPlacedFor(payment.reference);
      placeOrderRef.current(payment.reference);
    }
  }, [payment, placedFor]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-stretch justify-center gap-6 px-6 py-10">
      {query.isLoading || !hydrated ? (
        <div className="h-44 animate-pulse rounded-2xl bg-slate-100" />
      ) : query.isError ? (
        <ResultPanel tone="error" title="We couldn't check that payment">
          <p>
            {query.error instanceof ApiError
              ? query.error.message
              : 'Something went wrong while confirming your payment.'}
          </p>
          <ResultActions primary={{ href: '/checkout', label: 'Back to checkout' }} />
        </ResultPanel>
      ) : payment?.status === 'SUCCESS' ? (
        <ResultPanel tone="success" title="Order placed">
          {placeOrder.data ? (
            <>
              <p>
                {formatKobo(placeOrder.data.total)} confirmed
                {payment.channel ? ` via ${payment.channel}` : ''} — order{' '}
                <span className="font-semibold text-slate-800">{placeOrder.data.orderNumber}</span>{' '}
                is with Bokku now.
              </p>
              <div className="mt-2 flex flex-col items-center gap-2">
                <ResultActions
                  primary={{ href: `/orders/${placeOrder.data.id}`, label: 'Track your order' }}
                />
                <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
                  Back to shop
                </Link>
              </div>
            </>
          ) : placeOrder.isError ? (
            <>
              <p>
                {formatKobo(payment.amount)} confirmed — but finishing your order needs another
                attempt.
              </p>
              <p className="text-xs text-red-600">
                {placeOrder.error instanceof ApiError
                  ? placeOrder.error.message
                  : 'Something went wrong while placing the order.'}
              </p>
              <button
                type="button"
                onClick={() => placeOrder.mutate(payment.reference)}
                disabled={placeOrder.isPending}
                className="mt-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {placeOrder.isPending ? 'Placing your order…' : 'Retry placing the order'}
              </button>
              <p className="break-all text-xs text-slate-400">{payment.reference}</p>
            </>
          ) : (
            <p>
              {formatKobo(payment.amount)} confirmed
              {payment.channel ? ` via ${payment.channel}` : ''}. Placing your order…
            </p>
          )}
        </ResultPanel>
      ) : payment?.status === 'FAILED' ? (
        <ResultPanel tone="error" title="Payment failed">
          <p>
            Nothing was charged
            {payment.failureReason
              ? ` (${payment.failureReason.toLowerCase().replace('_', ' ')})`
              : ''}
            . You can try the payment again — your cart is untouched.
          </p>
          <ResultActions primary={{ href: '/checkout', label: 'Try again' }} />
        </ResultPanel>
      ) : (
        <ResultPanel tone="pending" title="Confirming your payment">
          <p>
            {timedOut
              ? 'This is taking longer than usual. Keep this page open or check again shortly — we only mark payments after the provider confirms them.'
              : 'Waiting for the payment provider to confirm…'}
          </p>
          {timedOut && (
            <button
              type="button"
              onClick={() => {
                setTimedOut(false);
                void query.refetch();
              }}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Check again
            </button>
          )}
        </ResultPanel>
      )}
    </main>
  );
}

function ResultPanel({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'error' | 'pending';
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    success: { ring: 'border-emerald-200 bg-emerald-50', icon: '✓', iconText: 'text-emerald-600' },
    error: { ring: 'border-red-200 bg-red-50', icon: '✕', iconText: 'text-red-600' },
    pending: { ring: 'border-brand-200 bg-brand-50', icon: '…', iconText: 'text-brand-600' },
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-col items-center gap-3 rounded-2xl border p-8 text-center ${styles.ring}`}
    >
      <span className={`text-4xl font-bold ${styles.iconText}`} aria-hidden>
        {styles.icon}
      </span>
      <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
      <div className="text-sm text-slate-600">{children}</div>
    </div>
  );
}

function ResultActions({ primary }: { primary: { href: string; label: string } }) {
  return (
    <Link
      href={primary.href}
      className="mt-1 inline-block rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
    >
      {primary.label}
    </Link>
  );
}
