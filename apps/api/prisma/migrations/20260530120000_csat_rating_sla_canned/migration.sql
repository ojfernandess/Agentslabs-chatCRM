-- CSAT rating display type on settings
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "csat_rating_type" VARCHAR(16) NOT NULL DEFAULT 'number';

-- SLA policies (organization-scoped)
CREATE TABLE IF NOT EXISTS "sla_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "first_response_time_minutes" INTEGER NOT NULL DEFAULT 5,
    "next_response_time_minutes" INTEGER NOT NULL DEFAULT 5,
    "resolution_time_minutes" INTEGER NOT NULL DEFAULT 60,
    "only_during_business_hours" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sla_policies_organization_id_idx" ON "sla_policies"("organization_id");

ALTER TABLE "sla_policies" DROP CONSTRAINT IF EXISTS "sla_policies_organization_id_fkey";
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Canned responses
CREATE TABLE IF NOT EXISTS "canned_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shortcut" VARCHAR(50) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "canned_responses_organization_id_shortcut_key" ON "canned_responses"("organization_id", "shortcut");
CREATE INDEX IF NOT EXISTS "canned_responses_organization_id_idx" ON "canned_responses"("organization_id");

ALTER TABLE "canned_responses" DROP CONSTRAINT IF EXISTS "canned_responses_organization_id_fkey";
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
