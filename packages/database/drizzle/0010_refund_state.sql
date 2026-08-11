CREATE TABLE "refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id" uuid NOT NULL REFERENCES "payments"("id") ON DELETE CASCADE,
  "amount" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'NGN',
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "provider_reference" text,
  "provider_status" text,
  "failure_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "refunds_status_valid" CHECK ("status" IN ('REQUESTED', 'PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'PROCESSED', 'FAILED'))
);

CREATE UNIQUE INDEX "refunds_payment_unique" ON "refunds" ("payment_id");
CREATE UNIQUE INDEX "refunds_provider_reference_unique" ON "refunds" ("provider_reference") WHERE "provider_reference" IS NOT NULL;
CREATE INDEX "refunds_status_idx" ON "refunds" ("status");
