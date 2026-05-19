-- CreateEnum
CREATE TYPE "ChatbotFlowSessionStatus" AS ENUM ('ACTIVE', 'WAITING_INPUT', 'COMPLETED');

-- CreateTable
CREATE TABLE "chatbot_flows" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "public_id" VARCHAR(40) NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "flow_definition" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "theme" JSONB,
    "settings" JSONB,
    "linked_bot_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_flow_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "chatbot_flow_id" UUID NOT NULL,
    "conversation_id" UUID,
    "contact_id" UUID,
    "current_node_id" VARCHAR(64),
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" "ChatbotFlowSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "waiting_input" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_flow_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_flows_public_id_key" ON "chatbot_flows"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_flows_linked_bot_id_key" ON "chatbot_flows"("linked_bot_id");

-- CreateIndex
CREATE INDEX "chatbot_flows_organization_id_idx" ON "chatbot_flows"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_flow_sessions_conversation_id_key" ON "chatbot_flow_sessions"("conversation_id");

-- CreateIndex
CREATE INDEX "chatbot_flow_sessions_organization_id_idx" ON "chatbot_flow_sessions"("organization_id");

-- CreateIndex
CREATE INDEX "chatbot_flow_sessions_chatbot_flow_id_idx" ON "chatbot_flow_sessions"("chatbot_flow_id");

-- AddForeignKey
ALTER TABLE "chatbot_flows" ADD CONSTRAINT "chatbot_flows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_flows" ADD CONSTRAINT "chatbot_flows_linked_bot_id_fkey" FOREIGN KEY ("linked_bot_id") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_flow_sessions" ADD CONSTRAINT "chatbot_flow_sessions_chatbot_flow_id_fkey" FOREIGN KEY ("chatbot_flow_id") REFERENCES "chatbot_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_flow_sessions" ADD CONSTRAINT "chatbot_flow_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
