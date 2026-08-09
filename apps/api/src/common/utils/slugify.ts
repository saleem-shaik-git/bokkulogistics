const MAX_SLUG_LENGTH = 80;

/** URL-safe slug: "Golden Penny Semovita 1kg" → "golden-penny-semovita-1kg". */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-+$/g, '') || 'item'
  );
}

/** Appends a short suffix for uniqueness: "indomie-70g-a3f9x2". */
export function withSuffix(slug: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}
