import type { AuthResponse, AuthTokens, PublicUser } from '@bokku/shared';
import type { LoginInput, RegisterInput } from '@bokku/validation';

import { apiRequest } from './api-client';

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/register', { body: input });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', { body: input });
}

export function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  return apiRequest<AuthTokens>('/auth/refresh', { body: { refreshToken } });
}

export function logout(refreshToken: string): Promise<{ message?: string } | null> {
  return apiRequest('/auth/logout', { body: { refreshToken } });
}

export function fetchMe(accessToken: string): Promise<PublicUser> {
  return apiRequest<PublicUser>('/auth/me', { accessToken });
}
