-- Billing / plan fields per tenant
ALTER TABLE "organizations" ADD COLUMN "plan_tier" VARCHAR(32) NOT NULL DEFAULT 'free';
ALTER TABLE "organizations" ADD COLUMN "billing_email" VARCHAR(255);
ALTER TABLE "organizations" ADD COLUMN "monthly_message_quota" INTEGER;

-- Global key-value settings (super admin)
CREATE TABLE "platform_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");
