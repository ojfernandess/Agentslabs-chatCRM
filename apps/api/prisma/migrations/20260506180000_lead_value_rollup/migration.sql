-- CreateEnum
CREATE TYPE "LeadValueRollup" AS ENUM ('PIPELINE', 'WON', 'LOST', 'NONE');

-- AlterTable
ALTER TABLE "lead_types" ADD COLUMN "value_roll_up" "LeadValueRollup" NOT NULL DEFAULT 'PIPELINE';

-- Backfill heuristics (idempotent-ish on re-run: only changes from PIPELINE where names match)
UPDATE "lead_types" SET "value_roll_up" = 'WON' WHERE LOWER(name) LIKE '%ganho%' OR LOWER(name) LIKE '%won%';
UPDATE "lead_types" SET "value_roll_up" = 'LOST' WHERE LOWER(name) LIKE '%perdido%' OR LOWER(name) LIKE '%lost%';
UPDATE "lead_types" SET "value_roll_up" = 'NONE' WHERE LOWER(name) LIKE '%suporte%' OR LOWER(name) LIKE '%relacionamento%';

-- Align deal status with stage lead-type rollup (default pipeline stages map to each org's CRM)
UPDATE "deals" d
SET
  "status" = CASE lt."value_roll_up"
    WHEN 'WON' THEN 'WON'::"DealStatus"
    WHEN 'LOST' THEN 'LOST'::"DealStatus"
    ELSE 'OPEN'::"DealStatus"
  END
FROM "pipeline_stages" ps
LEFT JOIN "lead_types" lt ON lt."id" = ps."lead_type_id"
WHERE d."stage_id" = ps."id";
