-- CreateEnum
CREATE TYPE "NvoipAccountStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "nvoip_accounts" (
    "id" UUID NOT NULL,
    "numbersip" VARCHAR(64) NOT NULL,
    "user_token_enc" TEXT NOT NULL,
    "napikey_enc" TEXT,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "default_caller" VARCHAR(32) NOT NULL,
    "status" "NvoipAccountStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "inbox_id" UUID,
    "last_balance" VARCHAR(32),
    "last_status_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "nvoip_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nvoip_agent_extensions" (
    "id" UUID NOT NULL,
    "caller" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "nvoip_agent_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nvoip_call_logs" (
    "id" UUID NOT NULL,
    "external_call_id" VARCHAR(128) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "caller" VARCHAR(32) NOT NULL,
    "receiver" VARCHAR(32) NOT NULL,
    "status" VARCHAR(64) NOT NULL,
    "duration_sec" INTEGER,
    "record_url" VARCHAR(2048),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "contact_id" UUID,
    "conversation_id" UUID,
    "message_id" UUID,
    "initiated_by_user_id" UUID,
    "client_call_id" VARCHAR(128),

    CONSTRAINT "nvoip_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nvoip_integration_logs" (
    "id" UUID NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID,

    CONSTRAINT "nvoip_integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nvoip_accounts_organization_id_key" ON "nvoip_accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "nvoip_agent_extensions_organization_id_user_id_key" ON "nvoip_agent_extensions"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "nvoip_agent_extensions_nvoip_account_id_idx" ON "nvoip_agent_extensions"("nvoip_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "nvoip_call_logs_message_id_key" ON "nvoip_call_logs"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "nvoip_call_logs_client_call_id_key" ON "nvoip_call_logs"("client_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "nvoip_call_logs_nvoip_account_id_external_call_id_key" ON "nvoip_call_logs"("nvoip_account_id", "external_call_id");

-- CreateIndex
CREATE INDEX "nvoip_call_logs_organization_id_idx" ON "nvoip_call_logs"("organization_id");

-- CreateIndex
CREATE INDEX "nvoip_call_logs_nvoip_account_id_idx" ON "nvoip_call_logs"("nvoip_account_id");

-- CreateIndex
CREATE INDEX "nvoip_call_logs_initiated_by_user_id_idx" ON "nvoip_call_logs"("initiated_by_user_id");

-- CreateIndex
CREATE INDEX "nvoip_integration_logs_organization_id_created_at_idx" ON "nvoip_integration_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "nvoip_accounts" ADD CONSTRAINT "nvoip_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_accounts" ADD CONSTRAINT "nvoip_accounts_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_agent_extensions" ADD CONSTRAINT "nvoip_agent_extensions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_agent_extensions" ADD CONSTRAINT "nvoip_agent_extensions_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_agent_extensions" ADD CONSTRAINT "nvoip_agent_extensions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_call_logs" ADD CONSTRAINT "nvoip_call_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_call_logs" ADD CONSTRAINT "nvoip_call_logs_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_call_logs" ADD CONSTRAINT "nvoip_call_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_call_logs" ADD CONSTRAINT "nvoip_call_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_call_logs" ADD CONSTRAINT "nvoip_call_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_call_logs" ADD CONSTRAINT "nvoip_call_logs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_integration_logs" ADD CONSTRAINT "nvoip_integration_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nvoip_integration_logs" ADD CONSTRAINT "nvoip_integration_logs_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
