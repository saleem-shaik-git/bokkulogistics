import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-10">
      <Link
        href="/"
        className="mb-8 text-sm font-semibold uppercase tracking-widest text-brand-600"
      >
        ← Bokku Logistics
      </Link>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}
