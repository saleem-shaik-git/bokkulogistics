import { ORDER_STATUS_LABELS, ORDER_TERMINAL_STATUSES, type OrderStatus } from '@bokku/shared';

/** Order status chip shared by customer and staff surfaces. */
export function StatusChip({ status }: { status: OrderStatus }) {
  const terminal = ORDER_TERMINAL_STATUSES.includes(status);
  const tone =
    status === 'DELIVERED'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'REFUNDED' || status === 'CANCELLED'
        ? 'bg-slate-100 text-slate-500'
        : terminal
          ? 'bg-slate-100 text-slate-500'
          : 'bg-amber-100 text-amber-700';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {!terminal && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
