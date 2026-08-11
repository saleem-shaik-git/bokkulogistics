import type { EntityStatus, UserRole } from './index';

/** User fields that are safe to expose outside the server. */
export interface PublicUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: EntityStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResponse {
  user: PublicUser;
  tokens: AuthTokens;
  /** Development-only helpers (never present in production builds). */
  debug?: {
    emailVerificationToken?: string;
    passwordResetToken?: string;
  };
}
