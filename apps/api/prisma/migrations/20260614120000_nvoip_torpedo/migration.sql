-- Nvoip torpedo (voice broadcast) dispatches and scheduled campaigns
CREATE TABLE "nvoip_torpedo_dispatches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "campaign_id" UUID,
    "contact_id" UUID,
    "called_phone" VARCHAR(32) NOT NULL,
    "caller" VARCHAR(32) NOT NULL,
    "message_text" TEXT NOT NULL,
    "webhook_token" VARCHAR(64) NOT NULL,
    "external_call_id" VARCHAR(128),
    "schedkey" VARCHAR(128),
    "status" VARCHAR(32) NOT NULL DEFAULT 'SENT',
    "dtmf_rules" JSONB,
    "dtmf_pressed" JSONB,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nvoip_torpedo_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nvoip_torpedo_dispatches_webhook_token_key" ON "nvoip_torpedo_dispatches"("webhook_token");
CREATE INDEX "nvoip_torpedo_dispatches_organization_id_idx" ON "nvoip_torpedo_dispatches"("organization_id");
CREATE INDEX "nvoip_torpedo_dispatches_campaign_id_idx" ON "nvoip_torpedo_dispatches"("campaign_id");
CREATE INDEX "nvoip_torpedo_dispatches_contact_id_idx" ON "nvoip_torpedo_dispatches"("contact_id");

ALTER TABLE "nvoip_torpedo_dispatches" ADD CONSTRAINT "nvoip_torpedo_dispatches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_torpedo_dispatches" ADD CONSTRAINT "nvoip_torpedo_dispatches_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_torpedo_dispatches" ADD CONSTRAINT "nvoip_torpedo_dispatches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nvoip_torpedo_dispatches" ADD CONSTRAINT "nvoip_torpedo_dispatches_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "nvoip_scheduled_torpedos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "campaign_id" UUID,
    "schedkey" VARCHAR(128) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nvoip_scheduled_torpedos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nvoip_scheduled_torpedos_schedkey_key" ON "nvoip_scheduled_torpedos"("schedkey");
CREATE INDEX "nvoip_scheduled_torpedos_organization_id_idx" ON "nvoip_scheduled_torpedos"("organization_id");

ALTER TABLE "nvoip_scheduled_torpedos" ADD CONSTRAINT "nvoip_scheduled_torpedos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_scheduled_torpedos" ADD CONSTRAINT "nvoip_scheduled_torpedos_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_scheduled_torpedos" ADD CONSTRAINT "nvoip_scheduled_torpedos_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
