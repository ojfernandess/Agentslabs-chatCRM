-- CreateEnum
CREATE TYPE "MessageReactionSenderType" AS ENUM ('CONTACT', 'AGENT');

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" UUID NOT NULL,
    "emoji" VARCHAR(32) NOT NULL,
    "actor_key" VARCHAR(128) NOT NULL,
    "sender_type" "MessageReactionSenderType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "message_id" UUID NOT NULL,
    "actor_user_id" UUID,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_actor_key_key" ON "message_reactions"("message_id", "actor_key");

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
