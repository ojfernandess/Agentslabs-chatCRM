-- Lead type: enable agent binding warning on resolve
ALTER TABLE "lead_types" ADD COLUMN "enable_agent_binding" BOOLEAN NOT NULL DEFAULT false;

-- Contact: track which agent saved the lead
ALTER TABLE "contacts" ADD COLUMN "lead_saved_by_id" UUID;
ALTER TABLE "contacts" ADD COLUMN "lead_saved_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "lead_saved_lead_type_id" UUID;
ALTER TABLE "contacts" ADD COLUMN "lead_saved_closure_record_id" UUID;

CREATE INDEX "contacts_lead_saved_by_id_idx" ON "contacts"("lead_saved_by_id");
CREATE INDEX "contacts_lead_saved_lead_type_id_idx" ON "contacts"("lead_saved_lead_type_id");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_saved_by_id_fkey" FOREIGN KEY ("lead_saved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_saved_lead_type_id_fkey" FOREIGN KEY ("lead_saved_lead_type_id") REFERENCES "lead_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conversation: record lead-owner prompt decision per attendance session
ALTER TABLE "conversations" ADD COLUMN "lead_owner_prompt_action" VARCHAR(16);
ALTER TABLE "conversations" ADD COLUMN "lead_owner_prompt_decided_by_id" UUID;
ALTER TABLE "conversations" ADD COLUMN "lead_owner_prompt_decided_at" TIMESTAMP(3);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_owner_prompt_decided_by_id_fkey" FOREIGN KEY ("lead_owner_prompt_decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
