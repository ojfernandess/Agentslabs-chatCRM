-- Phase 0: multi-provider payment foundation (Stripe unchanged; Mercado Pago ready).

CREATE TYPE "PaymentProvider" AS ENUM ('stripe', 'mercadopago');

ALTER TABLE "plans" ADD COLUMN "mercadopago_plan_id" VARCHAR(255);

ALTER TABLE "organization_subscriptions" ADD COLUMN "payment_provider" "PaymentProvider" NOT NULL DEFAULT 'stripe';
ALTER TABLE "organization_subscriptions" ADD COLUMN "external_customer_id" VARCHAR(255);
ALTER TABLE "organization_subscriptions" ADD COLUMN "external_subscription_id" VARCHAR(255);
ALTER TABLE "organization_subscriptions" ADD COLUMN "external_price_id" VARCHAR(255);

CREATE UNIQUE INDEX "organization_subscriptions_external_subscription_id_key"
  ON "organization_subscriptions"("external_subscription_id");

UPDATE "organization_subscriptions"
SET
  "external_customer_id" = "stripe_customer_id",
  "external_subscription_id" = "stripe_subscription_id",
  "external_price_id" = "stripe_price_id"
WHERE "stripe_customer_id" IS NOT NULL
   OR "stripe_subscription_id" IS NOT NULL
   OR "stripe_price_id" IS NOT NULL;

CREATE TABLE "payment_provider_connections" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  "environment" VARCHAR(16) NOT NULL DEFAULT 'sandbox',
  "access_token_enc" TEXT,
  "public_key" VARCHAR(255),
  "external_user_id" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "connected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_provider_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_provider_connections_organization_id_provider_key"
  ON "payment_provider_connections"("organization_id", "provider");

CREATE INDEX "payment_provider_connections_provider_status_idx"
  ON "payment_provider_connections"("provider", "status");

ALTER TABLE "payment_provider_connections"
  ADD CONSTRAINT "payment_provider_connections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_webhook_events" (
  "id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "external_event_id" VARCHAR(255) NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "payload_hash" VARCHAR(64),
  "status" VARCHAR(32) NOT NULL DEFAULT 'processed',
  "payload" JSONB,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_events_provider_external_event_id_key"
  ON "payment_webhook_events"("provider", "external_event_id");

CREATE INDEX "payment_webhook_events_provider_status_idx"
  ON "payment_webhook_events"("provider", "status");
