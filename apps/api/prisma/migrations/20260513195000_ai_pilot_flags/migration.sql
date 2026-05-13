-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "assistant_ai_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ai_pilot_access_enabled" BOOLEAN NOT NULL DEFAULT false;

