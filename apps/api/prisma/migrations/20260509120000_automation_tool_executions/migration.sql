-- AlterTable
ALTER TABLE "automation_custom_tools" ALTER COLUMN "tool_type" SET DATA TYPE VARCHAR(64);

-- AlterTable
ALTER TABLE "automation_custom_tools" ADD COLUMN IF NOT EXISTS "last_executed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "execution_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "avg_duration_ms" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "automation_tool_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "source" VARCHAR(32) NOT NULL DEFAULT 'manual_test',
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "status_code" INTEGER,
    "duration_ms" INTEGER,
    "request_summary" JSONB,
    "response_summary" JSONB,
    "error_message" TEXT,
    "tokens_used" INTEGER,
    "bot_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_tool_executions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "automation_tool_executions" ADD CONSTRAINT "automation_tool_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_tool_executions" ADD CONSTRAINT "automation_tool_executions_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "automation_custom_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "automation_tool_executions_organization_id_created_at_idx" ON "automation_tool_executions"("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "automation_tool_executions_tool_id_created_at_idx" ON "automation_tool_executions"("tool_id", "created_at");
