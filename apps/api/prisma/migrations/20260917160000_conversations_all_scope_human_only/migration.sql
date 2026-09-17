-- Hide finalized and bot-queue conversations from the «All conversations» list when enabled.
ALTER TABLE "settings" ADD COLUMN "conversations_all_scope_human_only" BOOLEAN NOT NULL DEFAULT false;
