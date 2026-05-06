-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN "lead_type_id" UUID;

-- CreateIndex
CREATE INDEX "pipeline_stages_lead_type_id_idx" ON "pipeline_stages"("lead_type_id");

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_lead_type_id_fkey" FOREIGN KEY ("lead_type_id") REFERENCES "lead_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link stages on the default pipeline to lead types with the same name in the same organization.
UPDATE "pipeline_stages" AS ps
SET "lead_type_id" = lt.id
FROM "lead_types" AS lt
INNER JOIN "pipelines" AS p ON p."organization_id" = lt."organization_id" AND p."is_default" = true
WHERE ps."pipeline_id" = p.id
  AND ps."lead_type_id" IS NULL
  AND ps."name" = lt."name";
