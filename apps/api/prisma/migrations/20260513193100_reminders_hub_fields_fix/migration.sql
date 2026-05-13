-- Ensure enums exist (idempotent)
DO $$
BEGIN
  CREATE TYPE "ReminderStatus" AS ENUM ('TODO', 'DOING', 'DONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReminderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ensure columns exist (idempotent)
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "status" "ReminderStatus";
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "priority" "ReminderPriority";
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

-- Backfill
UPDATE "reminders"
SET "status" = CASE WHEN "completed" = TRUE THEN 'DONE' ELSE 'TODO' END
WHERE "status" IS NULL;

UPDATE "reminders"
SET "priority" = CASE
  WHEN "completed" = TRUE THEN 'LOW'
  WHEN "due_at" < CURRENT_TIMESTAMP THEN 'URGENT'
  WHEN "due_at" < (CURRENT_DATE + INTERVAL '1 day') THEN 'HIGH'
  WHEN "due_at" < (CURRENT_DATE + INTERVAL '3 day') THEN 'MEDIUM'
  ELSE 'LOW'
END
WHERE "priority" IS NULL;

UPDATE "reminders"
SET "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
WHERE "updated_at" IS NULL;

-- Enforce constraints/defaults
ALTER TABLE "reminders" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "reminders" ALTER COLUMN "priority" SET NOT NULL;
ALTER TABLE "reminders" ALTER COLUMN "status" SET DEFAULT 'TODO';
ALTER TABLE "reminders" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';
ALTER TABLE "reminders" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "reminders" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS "reminders_organization_id_status_due_at_idx" ON "reminders"("organization_id", "status", "due_at");
CREATE INDEX IF NOT EXISTS "reminders_organization_id_priority_due_at_idx" ON "reminders"("organization_id", "priority", "due_at");

