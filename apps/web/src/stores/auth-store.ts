import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens, PublicUser } from '@bokku/shared';

/**
 * Auth session state. Tokens are persisted for MVP convenience;
 * moving the refresh token to an httpOnly cookie is a Phase 12 hardening item.
 * Server data (products/orders…) still belongs to TanStack Query — this
 * store only holds the session.
 */
interface AuthState {
  user: PublicUser | null;
  tokens: AuthTokens | null;
  setSession: (user: PublicUser, tokens: AuthTokens) => void;
  setTokens: (tokens: AuthTokens) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      setSession: (user, tokens) => set({ user, tokens }),
      setTokens: (tokens) => set({ tokens }),
      clearSession: () => set({ user: null, tokens: null }),
    }),
    { name: 'bokku-auth' },
  ),
);
