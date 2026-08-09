import { create } from 'zustand';

/**
 * Zustand holds ONLY ephemeral client/UI state.
 * Server data (products, cart, orders…) belongs to TanStack Query —
 * never duplicate API state here.
 */
interface UiState {
  cartDrawerOpen: boolean;
  setCartDrawerOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  cartDrawerOpen: false,
  setCartDrawerOpen: (cartDrawerOpen) => set({ cartDrawerOpen }),
}));
