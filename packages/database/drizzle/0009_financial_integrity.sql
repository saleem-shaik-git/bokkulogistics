ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_reserved_not_above_on_hand"
  CHECK ("reserved_quantity" <= "quantity_on_hand");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_non_negative"
  CHECK ("amount" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_money_non_negative"
  CHECK (
    "subtotal" >= 0 AND
    "delivery_fee" >= 0 AND
    "service_fee" >= 0 AND
    "tax" >= 0 AND
    "discount" >= 0 AND
    "total" >= 0
  );

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive"
  CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_unit_price_non_negative"
  CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "order_items_line_total_non_negative"
  CHECK ("line_total" >= 0);

CREATE INDEX IF NOT EXISTS "payments_success_without_order_idx"
  ON "payments" ("status", "updated_at")
  WHERE "status" = 'SUCCESS';
