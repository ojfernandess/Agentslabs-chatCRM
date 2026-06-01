-- CreateEnum
CREATE TYPE "ThreeCxRouteStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "threecx_route_points" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "pbx_base_url" VARCHAR(512) NOT NULL,
    "client_id" VARCHAR(120) NOT NULL,
    "api_key_enc" TEXT NOT NULL,
    "route_point_dn" VARCHAR(32) NOT NULL,
    "source_extension_dn" VARCHAR(32),
    "crm_api_key_enc" TEXT NOT NULL,
    "status" "ThreeCxRouteStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "inbox_id" UUID,
    "assigned_user_id" UUID,
    "external_config" JSONB,
    "monitored_dns" JSONB,
    "last_status_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "threecx_route_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threecx_call_logs" (
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
    "threecx_route_point_id" UUID NOT NULL,
    "contact_id" UUID,
    "conversation_id" UUID,
    "message_id" UUID,
    "initiated_by_user_id" UUID,
    "client_call_id" VARCHAR(128),

    CONSTRAINT "threecx_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threecx_integration_logs" (
    "id" UUID NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,
    "threecx_route_point_id" UUID,

    CONSTRAINT "threecx_integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "threecx_route_points_organization_id_name_key" ON "threecx_route_points"("organization_id", "name");

-- CreateIndex
CREATE INDEX "threecx_route_points_organization_id_idx" ON "threecx_route_points"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "threecx_call_logs_threecx_route_point_id_external_call_id_key" ON "threecx_call_logs"("threecx_route_point_id", "external_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "threecx_call_logs_message_id_key" ON "threecx_call_logs"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "threecx_call_logs_client_call_id_key" ON "threecx_call_logs"("client_call_id");

-- CreateIndex
CREATE INDEX "threecx_call_logs_organization_id_idx" ON "threecx_call_logs"("organization_id");

-- CreateIndex
CREATE INDEX "threecx_call_logs_threecx_route_point_id_idx" ON "threecx_call_logs"("threecx_route_point_id");

-- CreateIndex
CREATE INDEX "threecx_call_logs_initiated_by_user_id_idx" ON "threecx_call_logs"("initiated_by_user_id");

-- CreateIndex
CREATE INDEX "threecx_integration_logs_organization_id_created_at_idx" ON "threecx_integration_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "threecx_route_points" ADD CONSTRAINT "threecx_route_points_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_route_points" ADD CONSTRAINT "threecx_route_points_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_route_points" ADD CONSTRAINT "threecx_route_points_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_call_logs" ADD CONSTRAINT "threecx_call_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_call_logs" ADD CONSTRAINT "threecx_call_logs_threecx_route_point_id_fkey" FOREIGN KEY ("threecx_route_point_id") REFERENCES "threecx_route_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_call_logs" ADD CONSTRAINT "threecx_call_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_call_logs" ADD CONSTRAINT "threecx_call_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_call_logs" ADD CONSTRAINT "threecx_call_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_call_logs" ADD CONSTRAINT "threecx_call_logs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_integration_logs" ADD CONSTRAINT "threecx_integration_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threecx_integration_logs" ADD CONSTRAINT "threecx_integration_logs_threecx_route_point_id_fkey" FOREIGN KEY ("threecx_route_point_id") REFERENCES "threecx_route_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
