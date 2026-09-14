-- Extensão crm_deals: categorias de negócio (sem alterar core Deal/Product/LineItem)

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "category" VARCHAR(64);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "category_data" JSONB;

CREATE INDEX IF NOT EXISTS "deals_organization_id_category_idx" ON "deals"("organization_id", "category");

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_category_id" UUID;
CREATE INDEX IF NOT EXISTS "products_product_category_id_idx" ON "products"("product_category_id");

CREATE TABLE IF NOT EXISTS "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deal_category_key" VARCHAR(64),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_categories_organization_id_idx" ON "product_categories"("organization_id");

ALTER TABLE "products"
  ADD CONSTRAINT "products_product_category_id_fkey"
  FOREIGN KEY ("product_category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "deal_org_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "active_category" VARCHAR(64) NOT NULL DEFAULT 'default',
    "auto_generate_line_items" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    CONSTRAINT "deal_org_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "deal_org_settings_organization_id_key" ON "deal_org_settings"("organization_id");

ALTER TABLE "deal_org_settings"
  ADD CONSTRAINT "deal_org_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "deal_option_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "set_key" VARCHAR(120) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "category_key" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    CONSTRAINT "deal_option_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "deal_option_sets_organization_id_set_key_key" ON "deal_option_sets"("organization_id", "set_key");
CREATE INDEX IF NOT EXISTS "deal_option_sets_organization_id_idx" ON "deal_option_sets"("organization_id");

ALTER TABLE "deal_option_sets"
  ADD CONSTRAINT "deal_option_sets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "deal_option_set_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "option_set_id" UUID NOT NULL,
    CONSTRAINT "deal_option_set_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "deal_option_set_options_option_set_id_idx" ON "deal_option_set_options"("option_set_id");

ALTER TABLE "deal_option_set_options"
  ADD CONSTRAINT "deal_option_set_options_option_set_id_fkey"
  FOREIGN KEY ("option_set_id") REFERENCES "deal_option_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "deal_field_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_key" VARCHAR(64) NOT NULL,
    "field_key" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    CONSTRAINT "deal_field_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "deal_field_overrides_organization_id_category_key_field_key_key"
  ON "deal_field_overrides"("organization_id", "category_key", "field_key");
CREATE INDEX IF NOT EXISTS "deal_field_overrides_organization_id_category_key_idx"
  ON "deal_field_overrides"("organization_id", "category_key");

ALTER TABLE "deal_field_overrides"
  ADD CONSTRAINT "deal_field_overrides_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "deal_custom_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_key" VARCHAR(64) NOT NULL DEFAULT 'custom',
    "field_key" VARCHAR(120) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    CONSTRAINT "deal_custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "deal_custom_fields_organization_id_category_key_field_key_key"
  ON "deal_custom_fields"("organization_id", "category_key", "field_key");
CREATE INDEX IF NOT EXISTS "deal_custom_fields_organization_id_category_key_idx"
  ON "deal_custom_fields"("organization_id", "category_key");

ALTER TABLE "deal_custom_fields"
  ADD CONSTRAINT "deal_custom_fields_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
