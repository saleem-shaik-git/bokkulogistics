'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { completeMockPayment, fetchPayment } from '@/lib/payments-api';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';

/**
 * MOCK payment provider checkout page (dev/test stand-in for Paystack's
 * hosted page). Clicking a button reports the outcome to the API, which
 * settles the payment through the same confirmation path as a real
 * Paystack webhook — nothing here touches the payment row directly.
 */
export default function MockPaymentPage() {
  return (
    <Suspense>
      <MockPaymentContent />
    </Suspense>
  );
}

function MockPaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (hydrated && !user) {
      router.replace(`/login?next=${encodeURIComponent(`/payment/mock?reference=${reference}`)}`);
    }
  }, [hydrated, user, router, reference]);

  const paymentQuery = useQuery({
    queryKey: ['payment', reference],
    queryFn: () => fetchPayment(reference!),
    enabled: !!user && !!reference,
  });

  // Already settled? Skip the simulation and show the result.
  useEffect(() => {
    if (paymentQuery.data && paymentQuery.data.status !== 'PENDING' && reference) {
      router.replace(`/payment/result?reference=${encodeURIComponent(reference)}`);
    }
  }, [paymentQuery.data, reference, router]);

  const complete = useMutation({
    mutationFn: (outcome: 'success' | 'failed') => completeMockPayment(reference!, outcome),
    onSuccess: () => router.push(`/payment/result?reference=${encodeURIComponent(reference!)}`),
  });

  const payment = paymentQuery.data;
  const error = complete.error ?? paymentQuery.error;
  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-stretch justify-center gap-6 px-6 py-10">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Bokku Pay · sandbox
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Mock checkout</h1>
        <p className="mt-1 text-sm text-slate-500">
          This page stands in for Paystack while credentials are unavailable.
        </p>
      </div>

      {paymentQuery.isLoading || !hydrated ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      ) : payment ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-500">Amount to pay</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-slate-900">
            {formatKobo(payment.amount)}
          </p>
          <p className="mt-2 break-all text-xs text-slate-400">{payment.reference}</p>

          {errorMessage && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              disabled={complete.isPending}
              onClick={() => complete.mutate('success')}
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {complete.isPending ? 'Processing…' : 'Simulate successful payment'}
            </button>
            <button
              type="button"
              disabled={complete.isPending}
              onClick={() => complete.mutate('failed')}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-60"
            >
              Simulate failed payment
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-red-50 p-5 text-center text-sm text-red-700">
          <p className="font-semibold">{errorMessage ?? 'Payment not found.'}</p>
          <Link href="/checkout" className="mt-3 inline-block font-medium underline">
            Back to checkout
          </Link>
        </div>
      )}
    </main>
  );
}
