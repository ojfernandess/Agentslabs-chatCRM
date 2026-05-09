-- Conversation workflow / auto-resolve + manual resolve requirements
ALTER TABLE "settings" ADD COLUMN "auto_resolve_conversations_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "auto_resolve_inactivity_minutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "settings" ADD COLUMN "auto_resolve_customer_message" TEXT;
ALTER TABLE "settings" ADD COLUMN "auto_resolve_skip_when_assigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "auto_resolve_tag_id" UUID;
ALTER TABLE "settings" ADD COLUMN "auto_resolve_lead_type_id" UUID;
ALTER TABLE "settings" ADD COLUMN "resolve_require_closure_reason" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "settings" ADD COLUMN "resolve_require_lead_type" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "settings" ADD CONSTRAINT "settings_auto_resolve_tag_id_fkey" FOREIGN KEY ("auto_resolve_tag_id") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_auto_resolve_lead_type_id_fkey" FOREIGN KEY ("auto_resolve_lead_type_id") REFERENCES "lead_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
