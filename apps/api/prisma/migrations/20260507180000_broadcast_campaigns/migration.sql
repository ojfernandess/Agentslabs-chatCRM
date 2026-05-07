-- Campanhas de envio em massa (audiência por etiquetas, mensagem TEXT ou TEMPLATE).
CREATE TYPE "BroadcastCampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "broadcast_campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "BroadcastCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "message_type" "MessageType" NOT NULL,
    "body" TEXT,
    "template_id" UUID,
    "organization_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "broadcast_campaign_tags" (
    "campaign_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "broadcast_campaign_tags_pkey" PRIMARY KEY ("campaign_id","tag_id")
);

CREATE TABLE "broadcast_campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_campaign_recipients_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaign_tags" ADD CONSTRAINT "broadcast_campaign_tags_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaign_tags" ADD CONSTRAINT "broadcast_campaign_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "broadcast_campaign_recipients_campaign_id_contact_id_key" ON "broadcast_campaign_recipients"("campaign_id", "contact_id");

CREATE INDEX "broadcast_campaigns_organization_id_idx" ON "broadcast_campaigns"("organization_id");

CREATE INDEX "broadcast_campaigns_organization_id_status_idx" ON "broadcast_campaigns"("organization_id", "status");

CREATE INDEX "broadcast_campaign_recipients_campaign_id_idx" ON "broadcast_campaign_recipients"("campaign_id");
