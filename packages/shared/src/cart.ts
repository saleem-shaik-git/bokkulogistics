/**
 * Cart contracts shared by the API and the web app.
 *
 * Prices in the cart are always server-computed from the products table at
 * read time — the client never submits prices, and add-to-cart DTOs carry
 * no price field at all (enforced by the API's validation pipe).
 */

/** Maximum units of one product per cart line. */
export const CART_MAX_ITEM_QUANTITY = 99;

/** A single cart line with live, server-authoritative pricing. */
export interface PublicCartLine {
  /** Cart item id (used by PATCH/DELETE /cart/items/:id). */
  id: string;
  productId: string;
  name: string;
  slug: string;
  /** Server-side SKU (surfaced for order snapshots). */
  sku: string;
  imageUrl: string | null;
  /** Current unit price in kobo, read from the products table. */
  unitPrice: number;
  quantity: number;
  /** unitPrice × quantity, in kobo. */
  lineTotal: number;
  /** Sellable stock right now (on hand − reserved) — the stepper cap. */
  stockQuantity: number;
  /** False when the product is unavailable or stock no longer covers the quantity. */
  available: boolean;
}

/** The current user's cart (single-store). */
export interface PublicCart {
  /** null when the user has no cart yet (nothing was ever added). */
  id: string | null;
  storeId: string | null;
  items: PublicCartLine[];
  /** Total units across all lines. */
  itemCount: number;
  /** Sum of line totals in kobo (before fees — checkout adds those in Phase 5). */
  subtotal: number;
}

/** Returned when the user has never added anything (no cart row exists). */
export const EMPTY_CART: PublicCart = {
  id: null,
  storeId: null,
  items: [],
  itemCount: 0,
  subtotal: 0,
};
