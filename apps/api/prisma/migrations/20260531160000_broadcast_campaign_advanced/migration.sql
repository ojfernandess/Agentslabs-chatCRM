-- CreateEnum
CREATE TYPE "BroadcastChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'TELEGRAM', 'INSTAGRAM', 'MESSENGER', 'PUSH', 'WEBHOOK', 'VOICE');

-- CreateEnum
CREATE TYPE "BroadcastScheduleType" AS ENUM ('IMMEDIATE', 'SCHEDULED', 'RECURRING', 'EVENT');

-- CreateEnum
CREATE TYPE "BroadcastApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "channel" "BroadcastChannel" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN "inbox_id" UUID,
ADD COLUMN "subject" VARCHAR(500),
ADD COLUMN "schedule_type" "BroadcastScheduleType" NOT NULL DEFAULT 'IMMEDIATE',
ADD COLUMN "scheduled_at" TIMESTAMP(3),
ADD COLUMN "cron_expression" VARCHAR(120),
ADD COLUMN "next_run_at" TIMESTAMP(3),
ADD COLUMN "event_trigger" VARCHAR(64),
ADD COLUMN "event_config" JSONB,
ADD COLUMN "segment_rules" JSONB,
ADD COLUMN "flow_definition" JSONB,
ADD COLUMN "ab_config" JSONB,
ADD COLUMN "requires_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "approval_status" "BroadcastApprovalStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "approved_by_id" UUID,
ADD COLUMN "approved_at" TIMESTAMP(3),
ADD COLUMN "rejection_reason" TEXT,
ADD COLUMN "integration_tool_id" UUID,
ADD COLUMN "throttle_ms" INTEGER NOT NULL DEFAULT 750,
ADD COLUMN "use_distributed_queue" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "revenue_per_conversion" DECIMAL(12,2),
ADD COLUMN "response_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "conversion_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "roi_value" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "broadcast_campaign_recipients" ADD COLUMN "ab_variant" VARCHAR(1),
ADD COLUMN "opened_at" TIMESTAMP(3),
ADD COLUMN "responded_at" TIMESTAMP(3),
ADD COLUMN "converted_at" TIMESTAMP(3),
ADD COLUMN "queue_job_id" VARCHAR(64);

-- CreateIndex
CREATE INDEX "broadcast_campaigns_organization_id_schedule_type_next_run__idx" ON "broadcast_campaigns"("organization_id", "schedule_type", "next_run_at");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_inbox_id_idx" ON "broadcast_campaigns"("inbox_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_recipients_campaign_id_status_idx" ON "broadcast_campaign_recipients"("campaign_id", "status");

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_integration_tool_id_fkey" FOREIGN KEY ("integration_tool_id") REFERENCES "automation_custom_tools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
