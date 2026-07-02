-- Adicionar contacto rápido em «Nova mensagem» (Conversas).
ALTER TABLE "settings"
ADD COLUMN "conversations_quick_contact_add_enabled" BOOLEAN NOT NULL DEFAULT false;
