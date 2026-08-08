-- Membership multi-tenant (padrão Chatwoot/Slack): uma conta, várias organizações.
CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'AGENT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_organization_id_user_id_key"
  ON "organization_memberships"("organization_id", "user_id");

CREATE INDEX IF NOT EXISTS "organization_memberships_user_id_idx"
  ON "organization_memberships"("user_id");

CREATE INDEX IF NOT EXISTS "organization_memberships_organization_id_idx"
  ON "organization_memberships"("organization_id");

DO $$ BEGIN
  ALTER TABLE "organization_memberships"
    ADD CONSTRAINT "organization_memberships_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "organization_memberships"
    ADD CONSTRAINT "organization_memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: membros actuais (organization_id + role ADMIN/AGENT). SUPER_ADMIN sem org não entra.
INSERT INTO "organization_memberships" ("id", "organization_id", "user_id", "role", "created_at", "updated_at")
SELECT gen_random_uuid(), u."organization_id", u."id", u."role", u."created_at", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."organization_id" IS NOT NULL
  AND u."role" IN ('ADMIN', 'AGENT')
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
