'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { addressSchema, type AddressInput } from '@bokku/validation';
import type { PublicAddress } from '@bokku/shared';

import { useCreateAddress } from '@/hooks/use-addresses';
import { ApiError } from '@/lib/api-client';
import { TextField } from '@/components/forms/text-field';

/**
 * Inline "new address" form (React Hook Form + shared Zod schema).
 * Coordinates are intentionally not collected here — map picking lands
 * with MapsService (Phase 9); the mock quote uses its fallback distance.
 */
export function AddressForm({
  onCreated,
  onCancel,
}: {
  onCreated: (address: PublicAddress) => void;
  onCancel: () => void;
}) {
  const createAddress = useCreateAddress();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddressInput>({ resolver: zodResolver(addressSchema), mode: 'onBlur' });

  // Clear any stale server error when the user edits the form again.
  useEffect(() => () => createAddress.reset(), [createAddress]);

  const serverError =
    createAddress.error instanceof ApiError
      ? createAddress.error.message
      : createAddress.isError
        ? 'Could not save the address'
        : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/40 p-4"
      onSubmit={handleSubmit((values) => {
        createAddress.reset();
        createAddress.mutate(values, {
          onSuccess: (address) => {
            reset();
            onCreated(address);
          },
        });
      })}
    >
      <p className="text-sm font-semibold text-slate-700">New address</p>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Label (optional)" placeholder="Home" {...register('label')} />
        <div className="col-span-1">
          <TextField label="Landmark (optional)" placeholder="Near…" {...register('landmark')} />
        </div>
      </div>
      <TextField
        label="Street address"
        placeholder="24 Allen Avenue, Ikeja"
        error={errors.street?.message}
        {...register('street')}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="City"
          placeholder="Lagos"
          error={errors.city?.message}
          {...register('city')}
        />
        <TextField
          label="State"
          placeholder="Lagos"
          error={errors.state?.message}
          {...register('state')}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 accent-brand-600"
          {...register('isDefault')}
        />
        Make this my default address
      </label>

      {serverError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={createAddress.isPending}
          className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {createAddress.isPending ? 'Saving…' : 'Save address'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
