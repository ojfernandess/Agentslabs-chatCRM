-- Playbook de pós-finalização por tipo de lead + ligações conversa/negócio/lembrete
ALTER TABLE "lead_types" ADD COLUMN "closure_playbook" JSONB;

ALTER TABLE "reminders" ADD COLUMN "conversation_id" UUID;
ALTER TABLE "reminders" ADD COLUMN "closure_record_id" UUID;

ALTER TABLE "deals" ADD COLUMN "source_conversation_id" UUID;
ALTER TABLE "deals" ADD COLUMN "source_closure_record_id" UUID;

CREATE INDEX "reminders_conversation_id_idx" ON "reminders"("conversation_id");
CREATE INDEX "deals_source_conversation_id_idx" ON "deals"("source_conversation_id");

ALTER TABLE "reminders" ADD CONSTRAINT "reminders_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reminders" ADD CONSTRAINT "reminders_closure_record_id_fkey"
  FOREIGN KEY ("closure_record_id") REFERENCES "conversation_closure_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
