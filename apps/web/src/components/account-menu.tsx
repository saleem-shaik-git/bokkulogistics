'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { logout as logoutRequest } from '@/lib/auth-api';
import { useAuthStore } from '@/stores/auth-store';

/** Header account chip: sign-in links when anonymous, greeting + logout when authed. */
export function AccountMenu() {
  // Avoid hydration mismatch: persisted session only exists on the client.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  const tokens = useAuthStore((s) => s.tokens);
  const clearSession = useAuthStore((s) => s.clearSession);

  const logout = useMutation({
    mutationFn: async () => {
      if (tokens?.refreshToken) {
        // Best-effort server-side revocation; local session clears regardless.
        await logoutRequest(tokens.refreshToken).catch(() => null);
      }
    },
    onSettled: () => clearSession(),
  });

  if (!hydrated) {
    return <div className="h-9 w-24 rounded-xl bg-slate-100" aria-hidden />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/login"
          className="rounded-xl px-3 py-2 font-medium text-slate-600 hover:bg-slate-100"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded-xl bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700"
        >
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="text-right">
        <p className="font-medium text-slate-800">Hi, {user.firstName}</p>
        <p className="text-xs text-slate-400">
          <span className="capitalize">{user.role.toLowerCase().replace('_', ' ')}</span>
          {' · '}
          <Link href="/orders" className="font-medium text-brand-600 hover:underline">
            My orders
          </Link>
        </p>
      </div>
      <button
        onClick={() => logout.mutate()}
        className="rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:bg-slate-100"
      >
        {logout.isPending ? '…' : 'Sign out'}
      </button>
    </div>
  );
}
