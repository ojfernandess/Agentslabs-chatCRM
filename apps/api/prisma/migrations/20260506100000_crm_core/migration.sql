-- CRM core: pipelines explícitos, contas, negócios, produtos, linhas, timeline.

CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');
CREATE TYPE "TimelineSubjectType" AS ENUM ('CONTACT', 'ACCOUNT', 'DEAL');

CREATE TABLE "pipelines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pipelines_organization_id_idx" ON "pipelines"("organization_id");

ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "pipelines" ("organization_id", "name", "is_default", "sort_order")
SELECT o."id", 'Pipeline principal', true, 0
FROM "organizations" o;

ALTER TABLE "pipeline_stages" ADD COLUMN "pipeline_id" UUID;
ALTER TABLE "pipeline_stages" ADD COLUMN "probability_pct" INTEGER NOT NULL DEFAULT 0;

UPDATE "pipeline_stages" AS ps
SET "pipeline_id" = p."id"
FROM "pipelines" AS p
WHERE p."organization_id" = ps."organization_id" AND p."is_default" = true;

ALTER TABLE "pipeline_stages" ALTER COLUMN "pipeline_id" SET NOT NULL;

ALTER TABLE "pipeline_stages" DROP CONSTRAINT "pipeline_stages_organization_id_fkey";

DROP INDEX IF EXISTS "pipeline_stages_organization_id_idx";
DROP INDEX IF EXISTS "pipeline_stages_organization_id_name_key";

ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_name_key" ON "pipeline_stages"("pipeline_id", "name");

ALTER TABLE "pipeline_stages" DROP COLUMN "organization_id";

-- accounts
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "owner_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounts_organization_id_idx" ON "accounts"("organization_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contacts" ADD COLUMN "email" TEXT;
ALTER TABLE "contacts" ADD COLUMN "account_id" UUID;
ALTER TABLE "contacts" ADD COLUMN "lifecycle_stage" VARCHAR(64);

CREATE INDEX "contacts_account_id_idx" ON "contacts"("account_id");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "products_organization_id_idx" ON "products"("organization_id");

ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "probability_pct" INTEGER,
    "close_date" TIMESTAMP(3),
    "account_id" UUID,
    "primary_contact_id" UUID,
    "owner_id" UUID,
    "lost_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deals_organization_id_idx" ON "deals"("organization_id");
CREATE INDEX "deals_pipeline_id_idx" ON "deals"("pipeline_id");
CREATE INDEX "deals_stage_id_idx" ON "deals"("stage_id");

ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "deal_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deal_id" UUID NOT NULL,
    "product_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_pct" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "deal_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deal_line_items_deal_id_idx" ON "deal_line_items"("deal_id");

ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "subject_type" "TimelineSubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "channel" VARCHAR(32),
    "payload" JSONB NOT NULL,
    "actor_user_id" UUID,
    "source_id" VARCHAR(120),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "timeline_events_org_subject_occurred_idx" ON "timeline_events"("organization_id", "subject_type", "subject_id", "occurred_at");

ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
