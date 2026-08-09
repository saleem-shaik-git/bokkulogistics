const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Prices are integer kobo (minor units) across the whole system. */
export function formatKobo(kobo: number): string {
  return naira.format(kobo / 100);
}
