'use client';

import { useState } from 'react';
import { EntityStatus, UserRole } from '@bokku/shared';
import type { PublicUser } from '@bokku/shared';

import { useAdminUsers, useUpdateAdminUserRole, useUpdateAdminUserStatus } from '@/hooks/use-admin';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

const ROLE_OPTIONS = Object.values(UserRole);
const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: 'Customer',
  STORE_MANAGER: 'Store manager',
  BOKKU_ADMIN: 'Bokku admin',
  PLATFORM_ADMIN: 'Platform admin',
};

/**
 * User management: search/filter the user base and change roles or
 * suspend/reactivate accounts inline. The server audits every change and
 * refuses self-modification (controls on your own row are disabled).
 */
export default function AdminUsersPage() {
  const me = useAuthStore((s) => s.user);

  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<EntityStatus | ''>('');
  const [page, setPage] = useState(1);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const filters = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
  };
  const usersQuery = useAdminUsers(filters, page);
  const roleMutation = useUpdateAdminUserRole();
  const statusMutation = useUpdateAdminUserStatus();

  function applyFilters(next: { role?: UserRole | ''; status?: EntityStatus | ''; q?: string }) {
    setPage(1);
    if (next.role !== undefined) setRole(next.role);
    if (next.status !== undefined) setStatus(next.status);
    if (next.q !== undefined) setQ(next.q);
  }

  function mutateError(err: unknown) {
    setNote({
      tone: 'error',
      text: err instanceof ApiError ? err.message : 'The change failed — try again.',
    });
  }

  function changeRole(target: PublicUser, nextRole: UserRole) {
    if (nextRole === target.role) return;
    setNote(null);
    roleMutation.mutate(
      { userId: target.id, role: nextRole },
      {
        onSuccess: (updated) =>
          setNote({
            tone: 'ok',
            text: `${updated.email} is now ${ROLE_LABELS[updated.role]}.`,
          }),
        onError: mutateError,
      },
    );
  }

  function toggleStatus(target: PublicUser) {
    setNote(null);
    const next = target.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    statusMutation.mutate(
      { userId: target.id, status: next },
      {
        onSuccess: (updated) =>
          setNote({
            tone: 'ok',
            text:
              updated.status === 'SUSPENDED'
                ? `${updated.email} suspended — access is cut immediately.`
                : `${updated.email} reactivated.`,
          }),
        onError: mutateError,
      },
    );
  }

  const data = usersQuery.data;
  const busy = roleMutation.isPending || statusMutation.isPending;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters({ q: searchInput.trim() });
        }}
      >
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search email or name…"
          aria-label="Search users"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-300"
        />
        <select
          value={role}
          onChange={(e) => applyFilters({ role: e.target.value as UserRole | '' })}
          aria-label="Filter by role"
          className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm"
        >
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => applyFilters({ status: e.target.value as EntityStatus | '' })}
          aria-label="Filter by status"
          className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm"
        >
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <button
          type="submit"
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Search
        </button>
      </form>

      {note && (
        <p
          role="status"
          className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
            note.tone === 'ok'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {note.text}
        </p>
      )}

      {usersQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : usersQuery.isError || !data ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">Couldn&apos;t load users.</p>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {data.data.map((u) => {
                const self = u.id === me?.id;
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {u.firstName} {u.lastName}
                        {self && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            you
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-400">{u.email}</p>
                    </div>
                    <select
                      value={u.role}
                      disabled={self || busy}
                      onChange={(e) => changeRole(u, e.target.value as UserRole)}
                      aria-label={`Role for ${u.email}`}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        u.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700'
                          : u.status === 'SUSPENDED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {u.status.toLowerCase()}
                    </span>
                    {u.status !== 'INACTIVE' && (
                      <button
                        type="button"
                        disabled={self || busy}
                        onClick={() => toggleStatus(u)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                          u.status === 'SUSPENDED'
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100'
                        }`}
                      >
                        {u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                      </button>
                    )}
                  </li>
                );
              })}
              {data.data.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate-400">
                  No users match these filters.
                </li>
              )}
            </ul>
          </section>

          <Pager
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between text-sm text-slate-500">
      <span>
        {total} total · page {page} of {Math.max(totalPages, 1)}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40"
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
