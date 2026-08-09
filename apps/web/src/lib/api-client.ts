import type { ApiResponse } from '@bokku/shared';

/** Error thrown for any non-success API response, carrying the server error code. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
}

// Browser: same-origin via Next rewrites proxy. Server components/Node:
// absolute URL straight to the API (relative fetch doesn't exist there).
const SERVER_BASE =
  typeof window === 'undefined' ? (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000') : '';

/**
 * Envelope-aware API client. Unwraps `data` on success,
 * throws ApiError with the server `code` on failure.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_BASE}/api/v1${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Unable to reach the server', 0);
  }

  const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!res.ok || !payload || payload.success === false) {
    const error = payload && payload.success === false ? payload.error : null;
    throw new ApiError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? `Request failed with status ${res.status}`,
      res.status,
    );
  }
  return payload.data;
}
