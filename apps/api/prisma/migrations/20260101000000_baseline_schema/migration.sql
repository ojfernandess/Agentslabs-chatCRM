-- Esquema monolítico inicial (antes de multi-tenant). Necessário para instalações em BD vazia:
-- as migrações seguintes fazem ALTER em "settings", "users", etc., que de outro modo não existiriam.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT');

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'PENDING');

CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'TEMPLATE');

CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipeline_stages_name_key" ON "pipeline_stages"("name");

CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "wa_id" TEXT,
    "opted_in" BOOLEAN NOT NULL DEFAULT false,
    "opted_in_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_to_id" UUID,
    "pipeline_stage_id" UUID,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contacts_phone_key" ON "contacts"("phone");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_pipeline_stage_id_fkey" FOREIGN KEY ("pipeline_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contacts_assigned_to_id_idx" ON "contacts"("assigned_to_id");
CREATE INDEX "contacts_pipeline_stage_id_idx" ON "contacts"("pipeline_stage_id");

CREATE TABLE "contact_tags" (
    "contact_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contact_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");
CREATE INDEX "conversations_assigned_to_id_idx" ON "conversations"("assigned_to_id");
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "media_url" TEXT,
    "media_type" TEXT,
    "provider_msg_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversation_id" UUID NOT NULL,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");
CREATE INDEX "messages_provider_msg_id_idx" ON "messages"("provider_msg_id");

CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contact_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "reminders" ADD CONSTRAINT "reminders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "reminders_user_id_idx" ON "reminders"("user_id");
CREATE INDEX "reminders_due_at_idx" ON "reminders"("due_at");

CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider_template_id" TEXT,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auto_tag_rules" (
    "id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    CONSTRAINT "auto_tag_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "auto_tag_rules" ADD CONSTRAINT "auto_tag_rules_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "whatsapp_provider" TEXT,
    "whatsapp_api_key" TEXT,
    "whatsapp_phone_number_id" TEXT,
    "whatsapp_webhook_secret" TEXT,
    "auto_opt_in_on_first_message" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);
