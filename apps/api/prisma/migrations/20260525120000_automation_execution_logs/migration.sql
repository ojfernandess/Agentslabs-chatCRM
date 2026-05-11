-- CreateEnum
CREATE TYPE "AutomationLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateTable
CREATE TABLE "automation_execution_log_settings" (
    "organization_id" UUID NOT NULL,
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "min_persist_level" "AutomationLogLevel" NOT NULL DEFAULT 'DEBUG',
    "alert_webhook_url" VARCHAR(2048),
    "alert_email" VARCHAR(255),
    "alert_min_level" "AutomationLogLevel" NOT NULL DEFAULT 'ERROR',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_execution_log_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "conversation_id" UUID,
    "trigger_message_id" UUID,
    "workflow_key" VARCHAR(120) NOT NULL DEFAULT 'native_agent',
    "workflow_name" VARCHAR(200) NOT NULL DEFAULT '',
    "status" VARCHAR(24) NOT NULL DEFAULT 'running',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_execution_log_entries" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "AutomationLogLevel" NOT NULL,
    "node_id" VARCHAR(120) NOT NULL,
    "node_name" VARCHAR(200) NOT NULL,
    "node_path" VARCHAR(400) NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "input_context" JSONB,
    "output_context" JSONB,
    "stack_trace" TEXT,

    CONSTRAINT "automation_execution_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_executions_organization_id_started_at_idx" ON "automation_executions"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "automation_executions_bot_id_started_at_idx" ON "automation_executions"("bot_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "automation_executions_conversation_id_started_at_idx" ON "automation_executions"("conversation_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "automation_executions_workflow_key_started_at_idx" ON "automation_executions"("workflow_key", "started_at" DESC);

-- CreateIndex
CREATE INDEX "automation_execution_log_entries_execution_id_sequence_idx" ON "automation_execution_log_entries"("execution_id", "sequence");

-- CreateIndex
CREATE INDEX "automation_execution_log_entries_execution_id_level_idx" ON "automation_execution_log_entries"("execution_id", "level");

-- AddForeignKey
ALTER TABLE "automation_execution_log_settings" ADD CONSTRAINT "automation_execution_log_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_execution_log_entries" ADD CONSTRAINT "automation_execution_log_entries_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
