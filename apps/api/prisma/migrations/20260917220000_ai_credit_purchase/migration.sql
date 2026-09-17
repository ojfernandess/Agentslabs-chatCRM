-- CreateEnum
CREATE TYPE "AiCreditPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "ai_credit_packages" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "credit_amount" DECIMAL(18,8) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
    "stripe_price_id" VARCHAR(255),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "payment_provider" VARCHAR(32) NOT NULL,
    "status" "AiCreditPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "checkout_session_id" VARCHAR(255),
    "external_reference" VARCHAR(255),
    "credit_amount" DECIMAL(18,8) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_packages_slug_key" ON "ai_credit_packages"("slug");

-- CreateIndex
CREATE INDEX "ai_credit_packages_is_active_display_order_idx" ON "ai_credit_packages"("is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_purchases_idempotency_key_key" ON "ai_credit_purchases"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_credit_purchases_organization_id_created_at_idx" ON "ai_credit_purchases"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_credit_purchases_checkout_session_id_idx" ON "ai_credit_purchases"("checkout_session_id");

-- CreateIndex
CREATE INDEX "ai_credit_purchases_status_created_at_idx" ON "ai_credit_purchases"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ai_credit_purchases" ADD CONSTRAINT "ai_credit_purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_purchases" ADD CONSTRAINT "ai_credit_purchases_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "ai_credit_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed default packages (USD credits)
INSERT INTO "ai_credit_packages" ("id", "slug", "name", "description", "credit_amount", "amount_cents", "currency", "display_order", "is_active", "updated_at")
VALUES
  (gen_random_uuid(), 'starter-10', 'Starter — $10', 'Pacote inicial de créditos de IA', 10.00000000, 1000, 'USD', 10, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'growth-25', 'Growth — $25', 'Pacote recomendado para uso moderado', 25.00000000, 2500, 'USD', 20, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'pro-50', 'Pro — $50', 'Pacote para equipas com alto volume', 50.00000000, 5000, 'USD', 30, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
