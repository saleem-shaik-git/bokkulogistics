import { describe, expect, it } from 'vitest';

import { buildPaginationMeta, parsePagination } from '../src/common/pagination';
import { slugify, withSuffix } from '../src/common/utils/slugify';

describe('parsePagination', () => {
  it('applies defaults', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it('computes the offset from the page', () => {
    expect(parsePagination({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  it('caps the limit at 100', () => {
    expect(parsePagination({ limit: 500 }).limit).toBe(100);
  });

  it('floors page and limit at 1', () => {
    const parsed = parsePagination({ page: 0, limit: 0 });
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20); // 0 falls back to default
  });

  it('truncates fractional values', () => {
    expect(parsePagination({ page: 2.9, limit: 7.5 })).toEqual({ page: 2, limit: 7, offset: 7 });
  });
});

describe('buildPaginationMeta', () => {
  it('computes total pages', () => {
    expect(buildPaginationMeta(21, 1, 10)).toEqual({
      page: 1,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it('reports zero pages for empty sets', () => {
    expect(buildPaginationMeta(0, 1, 10).totalPages).toBe(0);
  });
});

describe('slugify', () => {
  it('normalizes names to url-safe slugs', () => {
    expect(slugify('Golden Penny Semovita 1kg')).toBe('golden-penny-semovita-1kg');
    expect(slugify('  Coca-Cola® 50cl PET!! ')).toBe('coca-cola-50cl-pet');
  });

  it('falls back for empty input and stays unique with suffix', () => {
    expect(slugify('###')).toBe('item');
    expect(withSuffix('rice')).not.toBe('rice');
    expect(withSuffix('rice')).toMatch(/^rice-[a-z0-9]{6}$/);
  });
});
