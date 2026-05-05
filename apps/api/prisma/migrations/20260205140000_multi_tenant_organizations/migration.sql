-- Multi-tenant: organizações, papel SUPER_ADMIN, isolamento por organization_id
-- Organização padrão para dados existentes
-- https://www.prisma.io/docs/orm/prisma-migrate

-- Novo valor do enum (PostgreSQL 11+)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

INSERT INTO "organizations" ("id", "name", "slug", "is_active")
VALUES ('11111111-1111-1111-1111-111111111111', 'Organização padrão', 'default', true);

ALTER TABLE "users" ADD COLUMN "organization_id" UUID;
UPDATE "users" SET "organization_id" = '11111111-1111-1111-1111-111111111111' WHERE "role" IN ('ADMIN', 'AGENT');
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

ALTER TABLE "contacts" ADD COLUMN "organization_id" UUID;
UPDATE "contacts" SET "organization_id" = '11111111-1111-1111-1111-111111111111';
ALTER TABLE "contacts" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_phone_key";
CREATE UNIQUE INDEX "contacts_organization_id_phone_key" ON "contacts"("organization_id", "phone");
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");

ALTER TABLE "tags" ADD COLUMN "organization_id" UUID;
UPDATE "tags" SET "organization_id" = '11111111-1111-1111-1111-111111111111';
ALTER TABLE "tags" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_name_key";
CREATE UNIQUE INDEX "tags_organization_id_name_key" ON "tags"("organization_id", "name");
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "tags_organization_id_idx" ON "tags"("organization_id");

ALTER TABLE "pipeline_stages" ADD COLUMN "organization_id" UUID;
UPDATE "pipeline_stages" SET "organization_id" = '11111111-1111-1111-1111-111111111111';
ALTER TABLE "pipeline_stages" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "pipeline_stages" DROP CONSTRAINT IF EXISTS "pipeline_stages_name_key";
CREATE UNIQUE INDEX "pipeline_stages_organization_id_name_key" ON "pipeline_stages"("organization_id", "name");
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pipeline_stages_organization_id_idx" ON "pipeline_stages"("organization_id");

ALTER TABLE "lead_types" ADD COLUMN "organization_id" UUID;
UPDATE "lead_types" SET "organization_id" = '11111111-1111-1111-1111-111111111111';
ALTER TABLE "lead_types" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "lead_types" DROP CONSTRAINT IF EXISTS "lead_types_name_key";
CREATE UNIQUE INDEX "lead_types_organization_id_name_key" ON "lead_types"("organization_id", "name");
ALTER TABLE "lead_types" ADD CONSTRAINT "lead_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "lead_types_organization_id_idx" ON "lead_types"("organization_id");

ALTER TABLE "conversations" ADD COLUMN "organization_id" UUID;
UPDATE "conversations" c SET "organization_id" = ct."organization_id" FROM "contacts" ct WHERE c."contact_id" = ct."id";
ALTER TABLE "conversations" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "conversations_organization_id_idx" ON "conversations"("organization_id");

ALTER TABLE "reminders" ADD COLUMN "organization_id" UUID;
UPDATE "reminders" r SET "organization_id" = c."organization_id" FROM "contacts" c WHERE r."contact_id" = c."id";
ALTER TABLE "reminders" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "reminders_organization_id_idx" ON "reminders"("organization_id");

ALTER TABLE "message_templates" ADD COLUMN "organization_id" UUID;
UPDATE "message_templates" SET "organization_id" = '11111111-1111-1111-1111-111111111111';
ALTER TABLE "message_templates" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "message_templates_organization_id_idx" ON "message_templates"("organization_id");

ALTER TABLE "auto_tag_rules" ADD COLUMN "organization_id" UUID;
UPDATE "auto_tag_rules" atr SET "organization_id" = t."organization_id" FROM "tags" t WHERE atr."tag_id" = t."id";
UPDATE "auto_tag_rules" SET "organization_id" = '11111111-1111-1111-1111-111111111111' WHERE "organization_id" IS NULL;
ALTER TABLE "auto_tag_rules" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "auto_tag_rules" ADD CONSTRAINT "auto_tag_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "auto_tag_rules_organization_id_idx" ON "auto_tag_rules"("organization_id");

ALTER TABLE "settings" ADD COLUMN "organization_id" UUID;
UPDATE "settings" SET "organization_id" = '11111111-1111-1111-1111-111111111111' WHERE "organization_id" IS NULL;
ALTER TABLE "settings" ALTER COLUMN "organization_id" SET NOT NULL;
CREATE UNIQUE INDEX "settings_organization_id_key" ON "settings"("organization_id");
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
