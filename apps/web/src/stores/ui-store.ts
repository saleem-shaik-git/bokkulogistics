import { create } from 'zustand';

export interface LocalCartLine {
  productId: string;
  name: string;
  /** Integer kobo. */
  price: number;
  imageUrl: string | null;
  quantity: number;
}

/**
 * Zustand holds ONLY ephemeral client/UI state — the local cart is exactly
 * that until Phase 4 syncs it to the server-side Cart API.
 * Server data (products/orders…) belongs to TanStack Query, never here.
 */
interface UiState {
  cartDrawerOpen: boolean;
  cart: LocalCartLine[];
  setCartDrawerOpen: (open: boolean) => void;
  addToCart: (line: Omit<LocalCartLine, 'quantity'>, quantity: number) => void;
  cartCount: () => number;
}

export const useUiStore = create<UiState>((set, get) => ({
  cartDrawerOpen: false,
  cart: [],
  setCartDrawerOpen: (cartDrawerOpen) => set({ cartDrawerOpen }),
  addToCart: (line, quantity) =>
    set((state) => {
      const existing = state.cart.find((item) => item.productId === line.productId);
      if (existing) {
        return {
          cart: state.cart.map((item) =>
            item.productId === line.productId
              ? { ...item, quantity: item.quantity + quantity }
              : item,
          ),
        };
      }
      return { cart: [...state.cart, { ...line, quantity }] };
    }),
  cartCount: () => get().cart.reduce((sum, item) => sum + item.quantity, 0),
}));
