CREATE TABLE "automation_knowledge_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "webhook_token" VARCHAR(64),
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" VARCHAR(20),
    "last_sync_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_knowledge_sources_webhook_token_key" ON "automation_knowledge_sources"("webhook_token");

CREATE INDEX "automation_knowledge_sources_organization_id_idx" ON "automation_knowledge_sources"("organization_id");

CREATE INDEX "automation_knowledge_sources_organization_id_kind_idx" ON "automation_knowledge_sources"("organization_id", "kind");

ALTER TABLE "automation_knowledge_sources" ADD CONSTRAINT "automation_knowledge_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_knowledge_articles" ADD COLUMN "knowledge_source_id" UUID;

CREATE INDEX "automation_knowledge_articles_knowledge_source_id_idx" ON "automation_knowledge_articles"("knowledge_source_id");

ALTER TABLE "automation_knowledge_articles" ADD CONSTRAINT "automation_knowledge_articles_knowledge_source_id_fkey" FOREIGN KEY ("knowledge_source_id") REFERENCES "automation_knowledge_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
