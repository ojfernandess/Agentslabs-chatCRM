-- Inbox conversation auto-assignment
ALTER TABLE "inboxes"
  ADD COLUMN IF NOT EXISTS "auto_assign_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_assign_limit" INTEGER;

-- CRM visual automation flows (distinct from automation_executions for agent bots)
CREATE TYPE "CrmFlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "CrmFlowType" AS ENUM ('CRM', 'WHATSAPP', 'TELEPHONY', 'AGENDA', 'SYSTEM');
CREATE TYPE "CrmFlowExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS "crm_flows" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "flow_type" "CrmFlowType" NOT NULL DEFAULT 'CRM',
  "status" "CrmFlowStatus" NOT NULL DEFAULT 'DRAFT',
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "flow_definition" JSONB NOT NULL,
  "trigger_config" JSONB NOT NULL DEFAULT '{}',
  "variables" JSONB NOT NULL DEFAULT '[]',
  "created_by_user_id" UUID,
  "last_executed_at" TIMESTAMP(3),
  "execution_count" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_flows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_flow_executions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "crm_flow_id" UUID NOT NULL,
  "status" "CrmFlowExecutionStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger_type" VARCHAR(64),
  "trigger_payload" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "error_message" TEXT,
  CONSTRAINT "crm_flow_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_flow_log_entries" (
  "id" UUID NOT NULL,
  "execution_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "node_id" VARCHAR(64),
  "node_type" VARCHAR(64),
  "level" VARCHAR(16) NOT NULL DEFAULT 'info',
  "message" TEXT NOT NULL,
  "input_context" JSONB,
  "output_context" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_flow_log_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_flow_templates" (
  "id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "flow_type" "CrmFlowType" NOT NULL DEFAULT 'CRM',
  "category" VARCHAR(64) NOT NULL,
  "flow_definition" JSONB NOT NULL,
  "trigger_config" JSONB NOT NULL DEFAULT '{}',
  "variables" JSONB NOT NULL DEFAULT '[]',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_flow_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_flow_templates_key_key" ON "crm_flow_templates"("key");
CREATE INDEX IF NOT EXISTS "crm_flows_organization_id_idx" ON "crm_flows"("organization_id");
CREATE INDEX IF NOT EXISTS "crm_flows_organization_id_status_idx" ON "crm_flows"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "crm_flow_executions_organization_id_idx" ON "crm_flow_executions"("organization_id");
CREATE INDEX IF NOT EXISTS "crm_flow_executions_crm_flow_id_idx" ON "crm_flow_executions"("crm_flow_id");
CREATE INDEX IF NOT EXISTS "crm_flow_executions_organization_id_started_at_idx" ON "crm_flow_executions"("organization_id", "started_at");
CREATE INDEX IF NOT EXISTS "crm_flow_log_entries_execution_id_idx" ON "crm_flow_log_entries"("execution_id");

ALTER TABLE "crm_flows"
  ADD CONSTRAINT "crm_flows_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_flow_executions"
  ADD CONSTRAINT "crm_flow_executions_crm_flow_id_fkey"
  FOREIGN KEY ("crm_flow_id") REFERENCES "crm_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_flow_log_entries"
  ADD CONSTRAINT "crm_flow_log_entries_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "crm_flow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
