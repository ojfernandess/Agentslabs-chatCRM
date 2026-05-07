-- Campos para templates sincronizados com WhatsApp Cloud API (WABA) e contagem de variáveis.
ALTER TABLE "message_templates" ADD COLUMN "template_language" VARCHAR(32) NOT NULL DEFAULT 'en';
ALTER TABLE "message_templates" ADD COLUMN "body_variable_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message_templates" ADD COLUMN "meta_category" VARCHAR(64);

CREATE INDEX "message_templates_organization_id_provider_template_id_template_language_idx" ON "message_templates"("organization_id", "provider_template_id", "template_language");
