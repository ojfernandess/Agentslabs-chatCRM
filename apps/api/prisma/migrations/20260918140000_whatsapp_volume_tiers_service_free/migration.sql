-- Phase 3: volume tiers + service free tier tracking on ledger

ALTER TABLE "message_billing_ledger"
  ADD COLUMN "inbox_id" UUID,
  ADD COLUMN "market" VARCHAR(80),
  ADD COLUMN "list_unit_price" DECIMAL(12, 6),
  ADD COLUMN "volume_tier_discount_percent" DECIMAL(5, 2),
  ADD COLUMN "service_free_tier_applied" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "message_billing_ledger_org_inbox_delivered_idx"
  ON "message_billing_ledger" ("organization_id", "inbox_id", "delivered_at");

CREATE TABLE "whatsapp_pricing_volume_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID,
  "market" VARCHAR(80) NOT NULL,
  "country_code" VARCHAR(8) NOT NULL,
  "category" VARCHAR(24) NOT NULL,
  "currency" VARCHAR(8) NOT NULL,
  "from_message" INTEGER NOT NULL,
  "to_message" INTEGER,
  "discount_percent" DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_until" TIMESTAMP(3),
  "source" VARCHAR(255),
  "version" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_pricing_volume_tiers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_pricing_volume_tiers_lookup_idx"
  ON "whatsapp_pricing_volume_tiers" ("country_code", "category", "version");

CREATE INDEX "whatsapp_pricing_volume_tiers_organization_id_idx"
  ON "whatsapp_pricing_volume_tiers" ("organization_id");

ALTER TABLE "whatsapp_pricing_volume_tiers"
  ADD CONSTRAINT "whatsapp_pricing_volume_tiers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
