-- CreateEnum
CREATE TYPE "AiWalletLedgerEntryType" AS ENUM (
  'CREDIT_ADJUSTMENT',
  'CREDIT_PURCHASE',
  'USAGE_DEBIT',
  'RESERVE_HOLD',
  'RESERVE_RELEASE',
  'REFUND'
);

-- CreateTable
CREATE TABLE "organization_ai_wallets" (
  "organization_id" UUID NOT NULL,
  "balance" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "reserved_balance" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_ai_wallets_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "ai_wallet_ledger_entries" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "entry_type" "AiWalletLedgerEntryType" NOT NULL,
  "amount" DECIMAL(18,8) NOT NULL,
  "balance_after" DECIMAL(18,8) NOT NULL,
  "reserved_after" DECIMAL(18,8) NOT NULL,
  "idempotency_key" VARCHAR(255),
  "reference_type" VARCHAR(64),
  "reference_id" VARCHAR(255),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_pricing" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "model" VARCHAR(128) NOT NULL,
  "input_price" DECIMAL(18,8) NOT NULL,
  "cached_input_price" DECIMAL(18,8),
  "output_price" DECIMAL(18,8) NOT NULL,
  "reasoning_price" DECIMAL(18,8),
  "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_until" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "agent_bot_id" UUID,
  "conversation_id" UUID,
  "provider" VARCHAR(32) NOT NULL,
  "requested_model" VARCHAR(128),
  "actual_model" VARCHAR(128),
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "provider_cost" DECIMAL(18,8) NOT NULL,
  "markup_percent" DECIMAL(8,4) NOT NULL,
  "platform_cost" DECIMAL(18,8) NOT NULL,
  "pricing_version_id" UUID NOT NULL,
  "openai_request_id" VARCHAR(255),
  "idempotency_key" VARCHAR(255) NOT NULL,
  "usage_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_wallet_ledger_entries_idempotency_key_key" ON "ai_wallet_ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_wallet_ledger_entries_organization_id_created_at_idx" ON "ai_wallet_ledger_entries"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_model_pricing_provider_model_effective_from_idx" ON "ai_model_pricing"("provider", "model", "effective_from");

-- CreateIndex
CREATE INDEX "ai_model_pricing_active_effective_from_idx" ON "ai_model_pricing"("active", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_records_idempotency_key_key" ON "ai_usage_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_usage_records_organization_id_created_at_idx" ON "ai_usage_records"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_pricing_version_id_idx" ON "ai_usage_records"("pricing_version_id");

-- AddForeignKey
ALTER TABLE "organization_ai_wallets" ADD CONSTRAINT "organization_ai_wallets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_wallet_ledger_entries" ADD CONSTRAINT "ai_wallet_ledger_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_pricing_version_id_fkey" FOREIGN KEY ("pricing_version_id") REFERENCES "ai_model_pricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed default OpenAI pricing (USD per 1M tokens) — versioned; histórico imutável.
INSERT INTO "ai_model_pricing" (
  "id", "provider", "model", "input_price", "cached_input_price", "output_price", "reasoning_price",
  "currency", "effective_from", "effective_until", "active", "created_at", "updated_at"
) VALUES
  (gen_random_uuid(), 'openai', 'gpt-4o-mini', 0.15000000, 0.07500000, 0.60000000, NULL, 'USD', TIMESTAMP '2024-01-01 00:00:00', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'openai', 'gpt-4o', 2.50000000, 1.25000000, 10.00000000, NULL, 'USD', TIMESTAMP '2024-01-01 00:00:00', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'openai', 'gpt-4.1-mini', 0.40000000, 0.10000000, 1.60000000, NULL, 'USD', TIMESTAMP '2024-01-01 00:00:00', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'openai', 'gpt-4.1', 2.00000000, 0.50000000, 8.00000000, NULL, 'USD', TIMESTAMP '2024-01-01 00:00:00', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
