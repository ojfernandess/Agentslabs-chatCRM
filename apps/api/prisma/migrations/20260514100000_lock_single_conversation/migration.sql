-- AlterTable: settings — conversa única por contacto (Chatwoot-style)
ALTER TABLE "settings" ADD COLUMN "lock_single_conversation" BOOLEAN NOT NULL DEFAULT false;
