CREATE TABLE "sip_call_logs" (
    "id" UUID NOT NULL,
    "client_call_id" VARCHAR(128) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "caller" VARCHAR(32) NOT NULL,
    "receiver" VARCHAR(32) NOT NULL,
    "status" VARCHAR(64) NOT NULL,
    "duration_sec" INTEGER,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    "contact_id" UUID,
    "conversation_id" UUID,
    "initiated_by_user_id" UUID,

    CONSTRAINT "sip_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sip_call_logs_client_call_id_key" ON "sip_call_logs"("client_call_id");
CREATE INDEX "sip_call_logs_organization_id_idx" ON "sip_call_logs"("organization_id");
CREATE INDEX "sip_call_logs_initiated_by_user_id_idx" ON "sip_call_logs"("initiated_by_user_id");

ALTER TABLE "sip_call_logs" ADD CONSTRAINT "sip_call_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sip_call_logs" ADD CONSTRAINT "sip_call_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sip_call_logs" ADD CONSTRAINT "sip_call_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sip_call_logs" ADD CONSTRAINT "sip_call_logs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
