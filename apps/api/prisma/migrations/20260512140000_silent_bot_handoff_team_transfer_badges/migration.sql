-- AlterTable
ALTER TABLE "settings" ADD COLUMN "silent_transfer_to_agent_bot" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "team_transfer_pulse_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "conversation_user_read_states" (
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_user_read_states_pkey" PRIMARY KEY ("user_id","conversation_id")
);

-- CreateIndex
CREATE INDEX "conversation_user_read_states_user_id_idx" ON "conversation_user_read_states"("user_id");

-- AddForeignKey
ALTER TABLE "conversation_user_read_states" ADD CONSTRAINT "conversation_user_read_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_user_read_states" ADD CONSTRAINT "conversation_user_read_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
