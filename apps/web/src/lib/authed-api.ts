import { ApiError, apiRequest } from './api-client';
import { refreshTokens } from './auth-api';
import { useAuthStore } from '@/stores/auth-store';

interface AuthedRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Authenticated API request with one transparent refresh-and-retry on 401.
 *
 * Reads/writes the session store directly (module singleton) so plain
 * functions — not just hooks — can call it. When the refresh token is
 * dead the session is cleared, which flips the UI back to signed-out.
 */
export async function authedRequest<T>(
  path: string,
  options: AuthedRequestOptions = {},
): Promise<T> {
  const { tokens } = useAuthStore.getState();
  if (!tokens) {
    throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue', 401);
  }

  try {
    return await apiRequest<T>(path, { ...options, accessToken: tokens.accessToken });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    const refreshed = await refreshTokens(tokens.refreshToken).catch(() => null);
    if (!refreshed) {
      useAuthStore.getState().clearSession();
      throw error;
    }
    useAuthStore.getState().setTokens(refreshed);
    return apiRequest<T>(path, { ...options, accessToken: refreshed.accessToken });
  }
}
