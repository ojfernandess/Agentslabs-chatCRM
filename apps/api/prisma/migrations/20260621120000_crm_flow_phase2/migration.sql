-- Phase 2: wait jobs + template seeds
ALTER TYPE "CrmFlowExecutionStatus" ADD VALUE IF NOT EXISTS 'WAITING';

CREATE TABLE IF NOT EXISTS "crm_flow_wait_jobs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "crm_flow_id" UUID NOT NULL,
  "execution_id" UUID NOT NULL,
  "next_node_id" VARCHAR(64) NOT NULL,
  "context" JSONB NOT NULL,
  "resume_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_flow_wait_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_flow_wait_jobs_execution_id_key" ON "crm_flow_wait_jobs"("execution_id");
CREATE INDEX IF NOT EXISTS "crm_flow_wait_jobs_organization_id_idx" ON "crm_flow_wait_jobs"("organization_id");
CREATE INDEX IF NOT EXISTS "crm_flow_wait_jobs_resume_at_idx" ON "crm_flow_wait_jobs"("resume_at");

ALTER TABLE "crm_flow_wait_jobs"
  ADD CONSTRAINT "crm_flow_wait_jobs_crm_flow_id_fkey"
  FOREIGN KEY ("crm_flow_id") REFERENCES "crm_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_flow_wait_jobs"
  ADD CONSTRAINT "crm_flow_wait_jobs_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "crm_flow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed templates (idempotent)
INSERT INTO "crm_flow_templates" ("id", "key", "name", "description", "flow_type", "category", "flow_definition", "trigger_config", "variables", "is_active", "created_at", "updated_at")
VALUES
  (
    gen_random_uuid(),
    'lead_distribution',
    'Distribuição automática de leads',
    'Atribui novos leads ao vendedor com menor carga.',
    'CRM',
    'crm',
    '{"nodes":[{"id":"trigger-1","type":"trigger","position":{"x":120,"y":40},"data":{"triggerType":"lead_created"}},{"id":"dist-1","type":"distribute_lead","position":{"x":120,"y":160},"data":{"method":"least_load"}},{"id":"end-1","type":"end","position":{"x":120,"y":280},"data":{}}],"edges":[{"id":"e1","source":"trigger-1","target":"dist-1"},{"id":"e2","source":"dist-1","target":"end-1"}]}'::jsonb,
    '{"type":"lead_created"}'::jsonb,
    '[]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'whatsapp_welcome',
    'Boas-vindas WhatsApp',
    'Envia mensagem de boas-vindas quando uma conversa é iniciada.',
    'WHATSAPP',
    'whatsapp',
    '{"nodes":[{"id":"trigger-1","type":"trigger","position":{"x":120,"y":40},"data":{"triggerType":"conversation_started"}},{"id":"wa-1","type":"send_whatsapp_text","position":{"x":120,"y":160},"data":{"message":"Olá {{nome}}! Como podemos ajudar?"}},{"id":"end-1","type":"end","position":{"x":120,"y":280},"data":{}}],"edges":[{"id":"e1","source":"trigger-1","target":"wa-1"},{"id":"e2","source":"wa-1","target":"end-1"}]}'::jsonb,
    '{"type":"conversation_started"}'::jsonb,
    '[]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'missed_call_callback',
    'Retorno de chamada perdida',
    'Cria tarefa de retorno após chamada perdida.',
    'TELEPHONY',
    'telephony',
    '{"nodes":[{"id":"trigger-1","type":"trigger","position":{"x":120,"y":40},"data":{"triggerType":"call_missed"}},{"id":"task-1","type":"create_task","position":{"x":120,"y":160},"data":{"title":"Retornar ligação para {{nome}}","description":"Chamada perdida em {{telefone}}"}},{"id":"end-1","type":"end","position":{"x":120,"y":280},"data":{}}],"edges":[{"id":"e1","source":"trigger-1","target":"task-1"},{"id":"e2","source":"task-1","target":"end-1"}]}'::jsonb,
    '{"type":"call_missed"}'::jsonb,
    '[]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'ai_lead_qualification',
    'Qualificação automática (IA)',
    'Classifica lead como quente, morno ou frio.',
    'CRM',
    'ia',
    '{"nodes":[{"id":"trigger-1","type":"trigger","position":{"x":120,"y":40},"data":{"triggerType":"lead_created"}},{"id":"ai-1","type":"ai_classify","position":{"x":120,"y":160},"data":{"mode":"lead_temperature"}},{"id":"end-1","type":"end","position":{"x":120,"y":280},"data":{}}],"edges":[{"id":"e1","source":"trigger-1","target":"ai-1"},{"id":"e2","source":"ai-1","target":"end-1"}]}'::jsonb,
    '{"type":"lead_created"}'::jsonb,
    '[]'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
