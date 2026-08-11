CREATE OR REPLACE FUNCTION enforce_refund_payment_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'REFUNDED' AND OLD.status <> 'REFUNDED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "refunds"
      WHERE "payment_id" = NEW.id
        AND "status" = 'PROCESSED'
    ) THEN
      RAISE EXCEPTION 'PAYMENT_REFUND_NOT_PROCESSED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_refund_state_guard ON "payments";
CREATE TRIGGER payments_refund_state_guard
BEFORE UPDATE OF "status" ON "payments"
FOR EACH ROW
EXECUTE FUNCTION enforce_refund_payment_state();
