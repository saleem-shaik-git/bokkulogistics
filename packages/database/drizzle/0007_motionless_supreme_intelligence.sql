CREATE TYPE "public"."delivery_provider" AS ENUM('MOCK', 'UBER', 'BOLT');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "delivery_provider" NOT NULL,
	"external_id" text NOT NULL,
	"status" "delivery_status" DEFAULT 'REQUESTED' NOT NULL,
	"quote_id" text,
	"courier" jsonb,
	"pickup" jsonb NOT NULL,
	"dropoff" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_unique" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("status");