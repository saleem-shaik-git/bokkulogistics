/**
 * Shared contracts used by both the API and the web app.
 * Keep this package free of runtime dependencies — types and constants only.
 */

/** Envelope returned by every successful API response. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Envelope returned by every failed API response. */
export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Pagination metadata for list endpoints (`?page=1&limit=20`). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Maximum allowed `limit` for paginated endpoints. */
export const PAGINATION_MAX_LIMIT = 100;
export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;

/** Health check payload shape (`GET /api/v1/health`). */
export interface HealthCheckResult {
  status: 'ok' | 'error';
  services: {
    api: 'up' | 'down';
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

/** User roles defined by the platform. */
export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  STORE_MANAGER: 'STORE_MANAGER',
  BOKKU_ADMIN: 'BOKKU_ADMIN',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Store / user lifecycle statuses. */
export const EntityStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export type EntityStatus = (typeof EntityStatus)[keyof typeof EntityStatus];

export * from './auth';
export * from './catalogue';
export * from './cart';
