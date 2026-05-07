-- AlterTable: settings — conversa única por contacto (lock single conversation)
ALTER TABLE "settings" ADD COLUMN "lock_single_conversation" BOOLEAN NOT NULL DEFAULT false;
