import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_MAX_LIMIT,
  type PaginationMeta,
} from '@bokku/shared';

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

/**
 * Normalizes ?page / ?limit (strings arrive via query params, class-transformer
 * coerces them first). Page floors at 1, limit is clamped to [1, 100].
 */
export function parsePagination(query: PaginationQuery): Pagination {
  const page = Math.max(
    1,
    Math.trunc(query.page ?? PAGINATION_DEFAULT_PAGE) || PAGINATION_DEFAULT_PAGE,
  );
  const rawLimit = Math.trunc(query.limit ?? PAGINATION_DEFAULT_LIMIT) || PAGINATION_DEFAULT_LIMIT;
  const limit = Math.min(PAGINATION_MAX_LIMIT, Math.max(1, rawLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
