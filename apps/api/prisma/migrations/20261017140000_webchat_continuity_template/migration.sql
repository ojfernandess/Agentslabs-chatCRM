-- AlterTable
ALTER TABLE "settings" ADD COLUMN "webchat_continuity_template_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "webchat_continuity_template_id" UUID;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_webchat_continuity_template_id_fkey" FOREIGN KEY ("webchat_continuity_template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
