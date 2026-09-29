-- Fase B3 — dedupe inbound WhatsApp (provider_msg_id por conversa) + índices CRM

-- Remove duplicatas legadas (mantém a mensagem mais antiga por par conversa+wamid)
DELETE FROM "messages" m
USING "messages" d
WHERE m."conversation_id" = d."conversation_id"
  AND m."provider_msg_id" IS NOT NULL
  AND m."provider_msg_id" = d."provider_msg_id"
  AND m."created_at" > d."created_at";

CREATE UNIQUE INDEX IF NOT EXISTS "messages_conversation_provider_msg_id_key"
  ON "messages" ("conversation_id", "provider_msg_id")
  WHERE "provider_msg_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "crm_flows_org_active_published_trigger_type_idx"
  ON "crm_flows" ("organization_id", ((trigger_config->>'type')))
  WHERE "status" = 'ACTIVE' AND "is_published" = true;

CREATE INDEX IF NOT EXISTS "crm_flows_org_status_published_idx"
  ON "crm_flows" ("organization_id", "status", "is_published");
