-- Message Policy Engine + Interaction Budget + Cost Control + Web Chat

-- CreateEnum
CREATE TYPE "InteractionBudgetStatus" AS ENUM ('ACTIVE', 'NEAR_LIMIT', 'LIMIT_REACHED', 'HUMAN_ACTIVE', 'RESET', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebchatSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterTable: messages.channel (origem/destino quando difere do canal da inbox, ex.: WEBCHAT)
ALTER TABLE "messages" ADD COLUMN "channel" VARCHAR(24);

-- AlterTable: settings — configuração Web Chat por organização
ALTER TABLE "settings" ADD COLUMN "webchat_link_expiration_hours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "settings" ADD COLUMN "webchat_continuity_message" TEXT;
ALTER TABLE "settings" ADD COLUMN "webchat_regenerate_policy" VARCHAR(16) NOT NULL DEFAULT 'revoke';

-- CreateTable: conversation_interaction_budgets
CREATE TABLE "conversation_interaction_budgets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "agent_bot_id" UUID,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "interaction_limit" INTEGER,
    "last_interaction_at" TIMESTAMP(3),
    "limit_reached_at" TIMESTAMP(3),
    "status" "InteractionBudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_interaction_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_interaction_budgets_conversation_id_key" ON "conversation_interaction_budgets"("conversation_id");
CREATE INDEX "conversation_interaction_budgets_organization_id_idx" ON "conversation_interaction_budgets"("organization_id");
CREATE INDEX "conversation_interaction_budgets_organization_id_status_idx" ON "conversation_interaction_budgets"("organization_id", "status");

ALTER TABLE "conversation_interaction_budgets" ADD CONSTRAINT "conversation_interaction_budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_interaction_budgets" ADD CONSTRAINT "conversation_interaction_budgets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: webchat_sessions
CREATE TABLE "webchat_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "token" VARCHAR(96) NOT NULL,
    "status" "WebchatSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by_source" VARCHAR(16) NOT NULL DEFAULT 'AGENT',
    "created_by_user_id" UUID,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webchat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webchat_sessions_token_key" ON "webchat_sessions"("token");
CREATE INDEX "webchat_sessions_organization_id_idx" ON "webchat_sessions"("organization_id");
CREATE INDEX "webchat_sessions_conversation_id_status_idx" ON "webchat_sessions"("conversation_id", "status");

ALTER TABLE "webchat_sessions" ADD CONSTRAINT "webchat_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webchat_sessions" ADD CONSTRAINT "webchat_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: message_billing_ledger
CREATE TABLE "message_billing_ledger" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID,
    "message_id" UUID,
    "provider_message_id" VARCHAR(255),
    "channel" VARCHAR(24) NOT NULL,
    "provider" VARCHAR(48),
    "message_category" VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    "template_id" UUID,
    "interaction_number" INTEGER,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "billing_status" VARCHAR(24) NOT NULL DEFAULT 'SENT',
    "estimated_cost" DECIMAL(12,6),
    "currency" VARCHAR(8),
    "pricing_version" VARCHAR(64),
    "policy_decision" VARCHAR(48),
    "policy_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_billing_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_billing_ledger_message_id_key" ON "message_billing_ledger"("message_id");
CREATE INDEX "message_billing_ledger_organization_id_sent_at_idx" ON "message_billing_ledger"("organization_id", "sent_at");
CREATE INDEX "message_billing_ledger_conversation_id_idx" ON "message_billing_ledger"("conversation_id");
CREATE INDEX "message_billing_ledger_provider_message_id_idx" ON "message_billing_ledger"("provider_message_id");

ALTER TABLE "message_billing_ledger" ADD CONSTRAINT "message_billing_ledger_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: whatsapp_pricing_rules
CREATE TABLE "whatsapp_pricing_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "market" VARCHAR(80) NOT NULL,
    "country_code" VARCHAR(8) NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "category" VARCHAR(24) NOT NULL,
    "price" DECIMAL(12,6) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "source" VARCHAR(255),
    "version" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_pricing_rules_country_code_category_idx" ON "whatsapp_pricing_rules"("country_code", "category");
CREATE INDEX "whatsapp_pricing_rules_organization_id_idx" ON "whatsapp_pricing_rules"("organization_id");

ALTER TABLE "whatsapp_pricing_rules" ADD CONSTRAINT "whatsapp_pricing_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
