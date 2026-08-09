import Link from 'next/link';

import { AccountMenu } from '@/components/account-menu';
import { HealthStatus } from '@/components/health-status';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10 sm:max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Bokku Logistics
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Shop Bokku. Delivered fast.</h1>
        </div>
        <AccountMenu />
      </header>

      <p className="text-slate-600">
        Phase 1 foundation is live: Next.js storefront, NestJS API, PostgreSQL 16, Redis 7 and
        Swagger docs — wired together in a Turborepo monorepo.
      </p>

      <HealthStatus />

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Catalogue</p>
          <p className="mt-1">Stores, categories &amp; products arrive in Phase 3.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Cart &amp; checkout</p>
          <p className="mt-1">Cart, addresses and pricing arrive in Phases 4–5.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Payments</p>
          <p className="mt-1">Paystack integration arrives in Phase 6.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Delivery</p>
          <p className="mt-1">Uber / Bolt adapters arrive in Phase 9.</p>
        </div>
      </section>

      <footer className="mt-auto text-xs text-slate-400">
        <Link href="/api/health" className="underline underline-offset-2">
          health endpoint
        </Link>{' '}
        · API docs served by the API at /api/docs
      </footer>
    </main>
  );
}
