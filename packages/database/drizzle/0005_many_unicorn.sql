CREATE TYPE "public"."payment_provider" AS ENUM('MOCK', 'PAYSTACK');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cart_id" uuid,
	"address_id" uuid,
	"store_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"email" text NOT NULL,
	"authorization_url" text,
	"provider_reference" text,
	"channel" text,
	"metadata" jsonb,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_unique" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_pending_per_cart" ON "payments" USING btree ("cart_id") WHERE "payments"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_provider_ref_idx" ON "payments" USING btree ("provider_reference");