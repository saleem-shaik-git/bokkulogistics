/**
 * Drizzle schema entrypoint.
 *
 * Phase 1 ships no business tables — tables are introduced per phase:
 *   Phase 2: users, refresh_tokens, password_reset_tokens, email_verification_tokens
 *   Phase 3: stores, categories, products, product_images, inventory
 *   Phase 4: carts, cart_items
 *   Phase 5: addresses
 *   Phase 6: payments, payment_transactions
 *   Phase 7: orders, order_items
 *   Phase 9: deliveries, delivery_events
 *   Phase 10/11: notifications, audit_logs
 *
 * Each table module lives in this directory and is re-exported here.
 */

export {};
