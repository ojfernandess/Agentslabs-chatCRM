-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "awaiting_human_handoff" BOOLEAN NOT NULL DEFAULT false;
