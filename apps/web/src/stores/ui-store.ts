import { create } from 'zustand';

/**
 * Zustand holds ONLY ephemeral client/UI state. Server data — the cart,
 * the catalogue, later orders — lives in TanStack Query, never here.
 */
interface UiState {
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  cartDrawerOpen: false,
  setCartDrawerOpen: (cartDrawerOpen) => set({ cartDrawerOpen }),
}));
