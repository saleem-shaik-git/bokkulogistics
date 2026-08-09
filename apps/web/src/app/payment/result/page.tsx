'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
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
        <ResultPanel tone="success" title="Payment received">
          <p>
            {formatKobo(payment.amount)} confirmed
            {payment.channel ? ` via ${payment.channel}` : ''}. Order placement and live tracking
            arrive with the next update — your cart is safely held as paid in the meantime.
          </p>
          <p className="break-all text-xs text-slate-400">{payment.reference}</p>
          <ResultActions primary={{ href: '/', label: 'Back to shop' }} />
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
