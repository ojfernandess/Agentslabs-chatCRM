-- Monitoramento financeiro OpenAI (Super Admin)
CREATE TABLE "openai_admin_recharges" (
    "id" UUID NOT NULL,
    "amount_usd" DECIMAL(18,6) NOT NULL,
    "recharged_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "adjusted_by_recharge_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openai_admin_recharges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "openai_admin_sync_snapshots" (
    "id" UUID NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "summary_usd" DECIMAL(18,6) NOT NULL,
    "error_message" TEXT,

    CONSTRAINT "openai_admin_sync_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "openai_admin_recharges_recharged_at_idx" ON "openai_admin_recharges"("recharged_at");
CREATE INDEX "openai_admin_sync_snapshots_synced_at_idx" ON "openai_admin_sync_snapshots"("synced_at");
