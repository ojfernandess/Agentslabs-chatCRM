-- CreateEnum
CREATE TYPE "TeamChannelMessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'FILE');

-- AlterTable
ALTER TABLE "team_channel_messages" ADD COLUMN "message_type" "TeamChannelMessageType" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "team_channel_messages" ADD COLUMN "attachment_url" VARCHAR(2048);
ALTER TABLE "team_channel_messages" ADD COLUMN "attachment_name" VARCHAR(512);
ALTER TABLE "team_channel_messages" ADD COLUMN "attachment_mime_type" VARCHAR(128);

-- CreateTable
CREATE TABLE "team_channel_message_reactions" (
    "id" UUID NOT NULL,
    "emoji" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "team_channel_message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_channel_message_reactions_message_id_idx" ON "team_channel_message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_channel_message_reactions_message_id_user_id_emoji_key" ON "team_channel_message_reactions"("message_id", "user_id", "emoji");

-- AddForeignKey
ALTER TABLE "team_channel_message_reactions" ADD CONSTRAINT "team_channel_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "team_channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_channel_message_reactions" ADD CONSTRAINT "team_channel_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
