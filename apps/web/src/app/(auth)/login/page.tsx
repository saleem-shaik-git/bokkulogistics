'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginInput } from '@bokku/validation';

import { TextField } from '@/components/forms/text-field';
import { isStaffRole } from '@/hooks/use-bokku';
import { ApiError } from '@/lib/api-client';
import { login as loginRequest } from '@/lib/auth-api';
import { useAuthStore } from '@/stores/auth-store';

/** Same-origin paths only — never let ?next= become an open redirect. */
function safeNextPath(next: string | null): string | null {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return null;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), mode: 'onBlur' });

  const mutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (data) => {
      setSession(data.user, data.tokens);
      // Explicit ?next= wins; otherwise platform admins land in the admin
      // console, store staff in the ops workspace, customers on the storefront.
      const target = safeNextPath(searchParams.get('next'));
      router.push(
        target ??
          (data.user.role === 'PLATFORM_ADMIN'
            ? '/admin'
            : isStaffRole(data.user.role)
              ? '/bokku'
              : '/'),
      );
    },
  });

  const serverError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? 'Something went wrong'
        : null;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to continue shopping.</p>

      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        {serverError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {mutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        New to Bokku?{' '}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
