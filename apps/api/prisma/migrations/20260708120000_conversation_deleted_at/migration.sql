-- Soft-delete / trash for conversations (email inbox)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "conversations_deleted_at_idx" ON "conversations"("deleted_at");
