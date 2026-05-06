-- AlterTable: bots — token de API p/ respostas (estilo Chatwoot) + segredo p/ assinar webhooks outbound
ALTER TABLE "bots" ADD COLUMN "inbox_token_prefix" VARCHAR(16);
ALTER TABLE "bots" ADD COLUMN "inbox_token_hash" TEXT;
ALTER TABLE "bots" ADD COLUMN "webhook_secret" VARCHAR(512);

CREATE UNIQUE INDEX "bots_inbox_token_prefix_key" ON "bots"("inbox_token_prefix") WHERE "inbox_token_prefix" IS NOT NULL;

-- AlterTable: settings — AgentBot ligado ao canal WhatsApp (uma conversa por organização)
ALTER TABLE "settings" ADD COLUMN "agent_bot_id" UUID;

CREATE UNIQUE INDEX "settings_agent_bot_id_key" ON "settings"("agent_bot_id") WHERE "agent_bot_id" IS NOT NULL;

ALTER TABLE "settings" ADD CONSTRAINT "settings_agent_bot_id_fkey" FOREIGN KEY ("agent_bot_id") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
