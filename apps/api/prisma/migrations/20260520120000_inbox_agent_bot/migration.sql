-- AlterTable
ALTER TABLE "inboxes" ADD COLUMN     "agent_bot_id" UUID;

-- CreateIndex
CREATE INDEX "inboxes_agent_bot_id_idx" ON "inboxes"("agent_bot_id");

-- AddForeignKey
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_agent_bot_id_fkey" FOREIGN KEY ("agent_bot_id") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
