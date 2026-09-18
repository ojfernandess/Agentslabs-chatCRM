-- Team purpose (operational vs communication) and org-wide collaboration workspace
CREATE TYPE "TeamPurpose" AS ENUM ('OPERATIONAL', 'COMMUNICATION');

ALTER TABLE "teams"
  ADD COLUMN "purpose" "TeamPurpose" NOT NULL DEFAULT 'OPERATIONAL',
  ADD COLUMN "is_org_collaboration_space" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "teams_organization_id_purpose_idx" ON "teams"("organization_id", "purpose");

CREATE UNIQUE INDEX "teams_org_collaboration_space_unique"
  ON "teams"("organization_id")
  WHERE "is_org_collaboration_space" = true;
