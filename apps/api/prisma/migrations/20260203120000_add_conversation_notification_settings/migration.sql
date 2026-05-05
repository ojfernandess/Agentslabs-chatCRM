-- AlterTable
ALTER TABLE "settings" ADD COLUMN "notify_conversation_open" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "settings" ADD COLUMN "notify_conversation_pending" BOOLEAN NOT NULL DEFAULT true;
