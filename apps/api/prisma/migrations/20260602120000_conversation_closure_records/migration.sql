-- Histórico permanente de encerramentos (auditoria não perde dados ao reabrir conversa).

CREATE TABLE "conversation_closure_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "session_index" INTEGER NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "resolved_by_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "team_id" UUID,
    "lead_type_id" UUID,
    "closure_reason" TEXT,
    "closure_value" DOUBLE PRECISION,
    "csat_score" INTEGER,
    "csat_comment" TEXT,
    "csat_recorded_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "reopened_by_id" UUID,
    "is_new_attendance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_closure_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_closure_records_conversation_id_session_index_key"
    ON "conversation_closure_records"("conversation_id", "session_index");

CREATE INDEX "conversation_closure_records_organization_id_resolved_at_idx"
    ON "conversation_closure_records"("organization_id", "resolved_at");

CREATE INDEX "conversation_closure_records_conversation_id_idx"
    ON "conversation_closure_records"("conversation_id");

CREATE INDEX "conversation_closure_records_assigned_to_id_idx"
    ON "conversation_closure_records"("assigned_to_id");

CREATE INDEX "conversation_closure_records_lead_type_id_idx"
    ON "conversation_closure_records"("lead_type_id");

CREATE INDEX "conversation_closure_records_team_id_idx"
    ON "conversation_closure_records"("team_id");

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_reopened_by_id_fkey"
    FOREIGN KEY ("reopened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_closure_records"
    ADD CONSTRAINT "conversation_closure_records_lead_type_id_fkey"
    FOREIGN KEY ("lead_type_id") REFERENCES "lead_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: conversas ainda resolvidas com dados de encerramento.
INSERT INTO "conversation_closure_records" (
    "id",
    "organization_id",
    "conversation_id",
    "session_index",
    "resolved_at",
    "resolved_by_id",
    "assigned_to_id",
    "team_id",
    "lead_type_id",
    "closure_reason",
    "closure_value",
    "csat_score",
    "csat_comment",
    "csat_recorded_at",
    "is_new_attendance",
    "created_at"
)
SELECT
    gen_random_uuid(),
    c."organization_id",
    c."id",
    1,
    c."updated_at",
    COALESCE(c."assigned_to_id", (
        SELECT u."id" FROM "users" u
        WHERE u."organization_id" = c."organization_id"
        ORDER BY u."created_at" ASC
        LIMIT 1
    )),
    c."assigned_to_id",
    c."team_id",
    c."lead_type_id",
    c."closure_reason",
    c."closure_value",
    c."csat_score",
    c."csat_comment",
    c."csat_recorded_at",
    false,
    c."updated_at"
FROM "conversations" c
WHERE c."status" = 'RESOLVED'
  AND (
    c."closure_reason" IS NOT NULL
    OR c."lead_type_id" IS NOT NULL
    OR c."closure_value" IS NOT NULL
    OR c."csat_score" IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "conversation_closure_records" r WHERE r."conversation_id" = c."id"
  );
