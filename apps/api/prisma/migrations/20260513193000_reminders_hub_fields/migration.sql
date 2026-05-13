-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('TODO', 'DOING', 'DONE');

-- CreateEnum
CREATE TYPE "ReminderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN "status" "ReminderStatus";
ALTER TABLE "reminders" ADD COLUMN "priority" "ReminderPriority";
ALTER TABLE "reminders" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill
UPDATE "reminders" SET "status" = CASE WHEN "completed" = TRUE THEN 'DONE' ELSE 'TODO' END WHERE "status" IS NULL;
UPDATE "reminders" SET "priority" = CASE
  WHEN "completed" = TRUE THEN 'LOW'
  WHEN "due_at" < CURRENT_TIMESTAMP THEN 'URGENT'
  WHEN "due_at" < (CURRENT_DATE + INTERVAL '1 day') THEN 'HIGH'
  WHEN "due_at" < (CURRENT_DATE + INTERVAL '3 day') THEN 'MEDIUM'
  ELSE 'LOW'
END WHERE "priority" IS NULL;

-- AlterTable (make non-null)
ALTER TABLE "reminders" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "reminders" ALTER COLUMN "priority" SET NOT NULL;
ALTER TABLE "reminders" ALTER COLUMN "status" SET DEFAULT 'TODO';
ALTER TABLE "reminders" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';

-- CreateIndex
CREATE INDEX "reminders_organization_id_status_due_at_idx" ON "reminders"("organization_id", "status", "due_at");
CREATE INDEX "reminders_organization_id_priority_due_at_idx" ON "reminders"("organization_id", "priority", "due_at");

