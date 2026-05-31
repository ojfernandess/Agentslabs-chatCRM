-- CreateEnum
CREATE TYPE "WavoipConnectionMode" AS ENUM ('QR_NATIVE', 'EXTERNAL_EVOLUTION', 'EXTERNAL_BAILEYS', 'SIP');

-- CreateEnum
CREATE TYPE "WavoipDeviceStatus" AS ENUM (
  'DISCONNECTED',
  'BUILDING',
  'CONNECTING',
  'OPEN',
  'CLOSE',
  'RESTARTING',
  'HIBERNATING',
  'WAITING_PAYMENT',
  'EXTERNAL_INTEGRATION_ERROR',
  'ERROR'
);

-- CreateTable
CREATE TABLE "wavoip_devices" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "device_token_enc" TEXT NOT NULL,
    "connection_mode" "WavoipConnectionMode" NOT NULL DEFAULT 'QR_NATIVE',
    "status" "WavoipDeviceStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "linked_phone" VARCHAR(32),
    "webhook_secret_enc" TEXT,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhook_events" JSONB,
    "sip_enabled" BOOLEAN NOT NULL DEFAULT false,
    "inbox_id" UUID,
    "assigned_user_id" UUID,
    "external_config" JSONB,
    "last_status_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "wavoip_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wavoip_call_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "wavoip_device_id" UUID NOT NULL,
    "contact_id" UUID,
    "conversation_id" UUID,
    "whatsapp_call_id" INTEGER NOT NULL,
    "id_session" INTEGER NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "caller" VARCHAR(32) NOT NULL,
    "receiver" VARCHAR(32) NOT NULL,
    "status" VARCHAR(64) NOT NULL,
    "duration_sec" INTEGER,
    "record_status" VARCHAR(32),
    "record_url" VARCHAR(2048),
    "call_type" VARCHAR(32),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wavoip_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wavoip_integration_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "wavoip_device_id" UUID,
    "level" VARCHAR(16) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wavoip_integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wavoip_devices_organization_id_idx" ON "wavoip_devices"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "wavoip_devices_organization_id_name_key" ON "wavoip_devices"("organization_id", "name");

-- CreateIndex
CREATE INDEX "wavoip_call_logs_organization_id_idx" ON "wavoip_call_logs"("organization_id");

-- CreateIndex
CREATE INDEX "wavoip_call_logs_wavoip_device_id_idx" ON "wavoip_call_logs"("wavoip_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "wavoip_call_logs_wavoip_device_id_whatsapp_call_id_key" ON "wavoip_call_logs"("wavoip_device_id", "whatsapp_call_id");

-- CreateIndex
CREATE INDEX "wavoip_integration_logs_organization_id_created_at_idx" ON "wavoip_integration_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "wavoip_devices" ADD CONSTRAINT "wavoip_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_devices" ADD CONSTRAINT "wavoip_devices_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_devices" ADD CONSTRAINT "wavoip_devices_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_call_logs" ADD CONSTRAINT "wavoip_call_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_call_logs" ADD CONSTRAINT "wavoip_call_logs_wavoip_device_id_fkey" FOREIGN KEY ("wavoip_device_id") REFERENCES "wavoip_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_call_logs" ADD CONSTRAINT "wavoip_call_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_call_logs" ADD CONSTRAINT "wavoip_call_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_call_logs" ADD CONSTRAINT "wavoip_call_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_integration_logs" ADD CONSTRAINT "wavoip_integration_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wavoip_integration_logs" ADD CONSTRAINT "wavoip_integration_logs_wavoip_device_id_fkey" FOREIGN KEY ("wavoip_device_id") REFERENCES "wavoip_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
