'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SERVICE_FEE_BPS, VAT_BPS, type CheckoutPreview, type PublicAddress } from '@bokku/shared';
import { useMutation } from '@tanstack/react-query';

import { AddressForm } from '@/components/address-form';
import { CartButton } from '@/components/cart-button';
import { useAddresses, useDeleteAddress, useSetDefaultAddress } from '@/hooks/use-addresses';
import { useCart } from '@/hooks/use-cart';
import { useCheckoutPreview } from '@/hooks/use-checkout-preview';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';
import { initializePayment } from '@/lib/payments-api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Checkout: pick a delivery address, review the fully server-computed price
 * breakdown (items + delivery quote + fees + VAT), then pay. The payment is
 * initialized server-side with this exact breakdown — the client never
 * submits amounts. Order placement arrives in Phase 7.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=%2Fcheckout');
  }, [hydrated, user, router]);

  const cartQuery = useCart();
  const addressesQuery = useAddresses();
  const setDefault = useSetDefaultAddress();
  const deleteAddress = useDeleteAddress();

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);

  const addresses = addressesQuery.data;
  // Prefer the explicit selection, then the default address, then the first.
  const effectiveAddressId = useMemo(() => {
    if (selectedAddressId && addresses?.some((a) => a.id === selectedAddressId)) {
      return selectedAddressId;
    }
    return addresses?.find((a) => a.isDefault)?.id ?? addresses?.[0]?.id ?? null;
  }, [addresses, selectedAddressId]);

  const cart = cartQuery.data;
  const previewQuery = useCheckoutPreview(effectiveAddressId, cart);

  if (!hydrated || !user) {
    return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10 sm:max-w-2xl" />;
  }

  const cartEmpty = cartQuery.isSuccess && (!cart || cart.items.length === 0);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8 sm:max-w-2xl">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
            ← Continue shopping
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Checkout</h1>
        </div>
        <CartButton />
      </header>

      {cartQuery.isLoading || addressesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : cartEmpty ? (
        <section className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <p className="font-semibold text-slate-700">Your cart is empty</p>
          <p className="mt-1 text-sm text-slate-400">Add something tasty before checking out.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Browse the shop
          </Link>
        </section>
      ) : (
        <>
          <section aria-labelledby="address-heading" className="flex flex-col gap-3">
            <h2
              id="address-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-500"
            >
              1 · Delivery address
            </h2>

            {addresses && addresses.length > 0 ? (
              <div role="radiogroup" aria-label="Delivery address" className="flex flex-col gap-2">
                {addresses.map((address) => (
                  <AddressCard
                    key={address.id}
                    address={address}
                    selected={address.id === effectiveAddressId}
                    mutating={setDefault.isPending || deleteAddress.isPending}
                    onSelect={() => setSelectedAddressId(address.id)}
                    onSetDefault={() => setDefault.mutate(address.id)}
                    onDelete={() => deleteAddress.mutate(address.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No saved addresses yet — add one to see your delivery fee.
              </p>
            )}

            {addingAddress ? (
              <AddressForm
                onCreated={(address) => {
                  setAddingAddress(false);
                  setSelectedAddressId(address.id);
                }}
                onCancel={() => setAddingAddress(false)}
              />
            ) : (
              (addresses?.length ?? 0) < 10 && (
                <button
                  type="button"
                  onClick={() => setAddingAddress(true)}
                  className="rounded-xl border border-dashed border-brand-300 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  + Add a new address
                </button>
              )
            )}
          </section>

          <section aria-labelledby="summary-heading" className="flex flex-col gap-3">
            <h2
              id="summary-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-500"
            >
              2 · Order summary
            </h2>

            {effectiveAddressId === null ? (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Add a delivery address to calculate fees and see your total.
              </p>
            ) : previewQuery.isLoading ? (
              <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
            ) : previewQuery.isError ? (
              <PreviewError error={previewQuery.error} />
            ) : previewQuery.data ? (
              <OrderSummary preview={previewQuery.data} />
            ) : null}
          </section>

          <section aria-labelledby="payment-heading" className="flex flex-col gap-2">
            <h2
              id="payment-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-500"
            >
              3 · Payment
            </h2>
            <PaymentSection addressId={effectiveAddressId} preview={previewQuery.data} />
          </section>
        </>
      )}
    </main>
  );
}

function AddressCard({
  address,
  selected,
  mutating,
  onSelect,
  onSetDefault,
  onDelete,
}: {
  address: PublicAddress;
  selected: boolean;
  mutating: boolean;
  onSelect: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={`cursor-pointer rounded-2xl border p-4 transition ${
        selected
          ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-100'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            {address.label ?? 'Address'}
            {address.isDefault && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700">
                Default
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">{address.street}</p>
          <p className="text-xs text-slate-400">
            {address.city}, {address.state}
            {address.landmark ? ` · ${address.landmark}` : ''}
          </p>
        </div>
        <span
          aria-hidden
          className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
            selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300'
          }`}
        />
      </div>
      <div className="mt-2 flex gap-3 text-xs font-medium text-slate-400">
        {!address.isDefault && (
          <button
            type="button"
            disabled={mutating}
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault();
            }}
            className="hover:text-brand-700 disabled:opacity-50"
          >
            Set as default
          </button>
        )}
        <button
          type="button"
          disabled={mutating}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="hover:text-red-600 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function PaymentSection({
  addressId,
  preview,
}: {
  addressId: string | null;
  preview: CheckoutPreview | undefined;
}) {
  const payment = useMutation({
    mutationFn: () =>
      initializePayment({
        addressId: addressId!,
        callbackUrl: `${window.location.origin}/payment/result`,
      }),
    onSuccess: (result) => {
      // Hosted checkout (Paystack) or the mock sandbox page — the API
      // decides the target; the browser is just sent there.
      window.location.assign(result.authorizationUrl);
    },
  });

  const ready = !!addressId && !!preview;
  const serverError =
    payment.error instanceof ApiError
      ? payment.error.message
      : payment.isError
        ? 'Could not start the payment'
        : null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={!ready || payment.isPending}
        onClick={() => payment.mutate()}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {payment.isPending
          ? 'Starting payment…'
          : preview
            ? `Pay ${formatKobo(preview.total)}`
            : 'Add an address to pay'}
      </button>
      {serverError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {serverError}
        </p>
      )}
      <p className="text-center text-xs text-slate-400">
        Secure checkout — the provider confirms every payment server-side. Your card never touches
        our servers.
      </p>
    </div>
  );
}

function PreviewError({ error }: { error: Error }) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
      <p className="font-semibold">{apiError?.message ?? 'Could not compute your order total.'}</p>
      {apiError?.code === 'CART_ITEMS_UNAVAILABLE' && (
        <p className="mt-1 text-xs">
          Open your cart and adjust the highlighted items, then come back.
        </p>
      )}
    </div>
  );
}

function OrderSummary({ preview }: { preview: CheckoutPreview }) {
  const rows: Array<{ label: string; amount: number; hint?: string }> = [
    { label: 'Subtotal', amount: preview.subtotal },
    {
      label: 'Delivery fee',
      amount: preview.deliveryFee,
      hint: `${preview.quote.distanceKm} km · ~${preview.quote.estimatedMinutes} min`,
    },
    { label: `Service fee (${SERVICE_FEE_BPS / 100}%)`, amount: preview.serviceFee },
    { label: `VAT (${VAT_BPS / 100}%)`, amount: preview.tax },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100 px-4">
        {preview.lines.map((line) => (
          <li key={line.productId} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{line.name}</p>
              <p className="text-xs text-slate-400">
                {line.quantity} × {formatKobo(line.unitPrice)}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold">{formatKobo(line.lineTotal)}</p>
          </li>
        ))}
      </ul>
      <dl className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <dt className="text-slate-500">
              {row.label}
              {row.hint && <span className="ml-1 text-xs text-slate-400">({row.hint})</span>}
            </dt>
            <dd className="font-medium">{formatKobo(row.amount)}</dd>
          </div>
        ))}
        {preview.discount > 0 && (
          <div className="flex items-center justify-between text-emerald-600">
            <dt>Discount</dt>
            <dd className="font-medium">−{formatKobo(preview.discount)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-base font-bold">
          <dt>Total</dt>
          <dd>{formatKobo(preview.total)}</dd>
        </div>
      </dl>
      <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
        Delivery by {preview.quote.provider === 'MOCK' ? 'Bokku dispatch' : preview.quote.provider}{' '}
        · quoted fee is held for a short window.
      </p>
    </div>
  );
}
