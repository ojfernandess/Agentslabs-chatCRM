-- CreateEnum
CREATE TYPE "LeadFinderScheduleType" AS ENUM ('SCHEDULED', 'RECURRING');

-- CreateTable
CREATE TABLE "lead_finder_segments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "niche" VARCHAR(200) NOT NULL,
    "city" VARCHAR(200) NOT NULL,
    "is_preset" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_finder_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_finder_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "search_mode" VARCHAR(16) NOT NULL,
    "niche" VARCHAR(200),
    "city" VARCHAR(200),
    "segment_id" UUID,
    "import_config" JSONB NOT NULL DEFAULT '{}',
    "schedule_type" "LeadFinderScheduleType" NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "recurrence" JSONB,
    "cron_expression" VARCHAR(100),
    "next_run_at" TIMESTAMP(3),
    "time_zone" VARCHAR(64),
    "follow_up_config" JSONB,
    "last_run_at" TIMESTAMP(3),
    "last_run_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "lead_finder_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_finder_segments_organization_id_idx" ON "lead_finder_segments"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_finder_segments_organization_id_name_key" ON "lead_finder_segments"("organization_id", "name");

-- CreateIndex
CREATE INDEX "lead_finder_schedules_organization_id_idx" ON "lead_finder_schedules"("organization_id");

-- CreateIndex
CREATE INDEX "lead_finder_schedules_enabled_next_run_at_idx" ON "lead_finder_schedules"("enabled", "next_run_at");

-- AddForeignKey
ALTER TABLE "lead_finder_segments" ADD CONSTRAINT "lead_finder_segments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_finder_schedules" ADD CONSTRAINT "lead_finder_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_finder_schedules" ADD CONSTRAINT "lead_finder_schedules_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "lead_finder_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
