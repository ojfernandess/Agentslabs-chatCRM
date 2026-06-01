-- WhatsApp HSM via Nvoip (Fase 6)
ALTER TABLE "nvoip_accounts" ADD COLUMN "wa_instance" VARCHAR(128);
ALTER TABLE "nvoip_accounts" ADD COLUMN "wa_default_language" VARCHAR(16) NOT NULL DEFAULT 'pt_BR';
