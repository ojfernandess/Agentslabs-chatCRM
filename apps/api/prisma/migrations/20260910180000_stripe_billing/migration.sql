-- Stripe billing: plans catalog, organization subscriptions, webhook idempotency

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_customer_id" VARCHAR(255);

CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'BRL',
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "interval" VARCHAR(16) NOT NULL DEFAULT 'month',
    "trial_days" INTEGER,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stripe_product_id" VARCHAR(255),
    "stripe_price_id" VARCHAR(255),
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '{}',
    "legacy_plan_tier" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

CREATE TABLE "organization_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID,
    "stripe_customer_id" VARCHAR(255),
    "stripe_subscription_id" VARCHAR(255),
    "stripe_price_id" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'inactive',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "trial_start" TIMESTAMP(3),
    "trial_end" TIMESTAMP(3),
    "checkout_session_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_subscriptions_organization_id_key" ON "organization_subscriptions"("organization_id");
CREATE UNIQUE INDEX "organization_subscriptions_stripe_subscription_id_key" ON "organization_subscriptions"("stripe_subscription_id");
CREATE INDEX "organization_subscriptions_status_idx" ON "organization_subscriptions"("status");

ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stripe_webhook_events" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(120) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Planos iniciais (espelham tiers legados free / growth / enterprise)
INSERT INTO "plans" ("slug", "name", "description", "currency", "amount_cents", "interval", "display_order", "legacy_plan_tier", "limits", "features")
VALUES
  ('free', 'Free', 'Plano gratuito', 'BRL', 0, 'month', 0, 'free',
   '{"agents":3,"automations":10,"contacts":1000,"messages":null}'::jsonb,
   '{"rag":false,"api":false,"mcp":false}'::jsonb),
  ('growth', 'Growth', 'Plano Growth', 'BRL', 9900, 'month', 1, 'growth',
   '{"agents":10,"automations":50,"contacts":10000,"messages":50000}'::jsonb,
   '{"rag":true,"api":true,"mcp":false}'::jsonb),
  ('enterprise', 'Enterprise', 'Plano Enterprise', 'BRL', 79900, 'month', 2, 'enterprise',
   '{"agents":null,"automations":null,"contacts":null,"messages":null}'::jsonb,
   '{"rag":true,"api":true,"mcp":true}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;

-- Assinaturas virtuais para orgs existentes (sem Stripe)
INSERT INTO "organization_subscriptions" ("organization_id", "plan_id", "status")
SELECT o.id, p.id, 'active'
FROM "organizations" o
JOIN "plans" p ON p.legacy_plan_tier = o.plan_tier
WHERE NOT EXISTS (
  SELECT 1 FROM "organization_subscriptions" s WHERE s.organization_id = o.id
);
