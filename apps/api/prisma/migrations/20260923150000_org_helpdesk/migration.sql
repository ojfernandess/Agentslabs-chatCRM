-- Org helpdesk requests (organization admin -> super admin)
CREATE TABLE "org_helpdesk_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    "progress_note" TEXT,
    "progress_percent" INTEGER,
    "created_by_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_helpdesk_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "org_helpdesk_messages" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_staff_reply" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_helpdesk_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "org_helpdesk_attachments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "message_id" UUID,
    "filename" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_helpdesk_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_helpdesk_requests_organization_id_status_idx" ON "org_helpdesk_requests"("organization_id", "status");
CREATE INDEX "org_helpdesk_requests_organization_id_created_at_idx" ON "org_helpdesk_requests"("organization_id", "created_at" DESC);
CREATE INDEX "org_helpdesk_requests_status_created_at_idx" ON "org_helpdesk_requests"("status", "created_at" DESC);
CREATE INDEX "org_helpdesk_messages_request_id_created_at_idx" ON "org_helpdesk_messages"("request_id", "created_at");
CREATE INDEX "org_helpdesk_attachments_request_id_idx" ON "org_helpdesk_attachments"("request_id");

ALTER TABLE "org_helpdesk_requests" ADD CONSTRAINT "org_helpdesk_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_helpdesk_requests" ADD CONSTRAINT "org_helpdesk_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "org_helpdesk_requests" ADD CONSTRAINT "org_helpdesk_requests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "org_helpdesk_requests" ADD CONSTRAINT "org_helpdesk_requests_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "org_helpdesk_messages" ADD CONSTRAINT "org_helpdesk_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "org_helpdesk_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_helpdesk_messages" ADD CONSTRAINT "org_helpdesk_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "org_helpdesk_attachments" ADD CONSTRAINT "org_helpdesk_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "org_helpdesk_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_helpdesk_attachments" ADD CONSTRAINT "org_helpdesk_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "org_helpdesk_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "org_helpdesk_attachments" ADD CONSTRAINT "org_helpdesk_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
