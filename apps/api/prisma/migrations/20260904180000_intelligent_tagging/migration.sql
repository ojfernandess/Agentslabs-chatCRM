-- Etiquetagem inteligente (opt-in por organização)
ALTER TABLE "settings"
  ADD COLUMN "intelligent_tagging_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "intelligent_tagging_min_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
  ADD COLUMN "intelligent_tagging_max_tags" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "intelligent_tagging_trigger" VARCHAR(16) NOT NULL DEFAULT 'manual';

CREATE TYPE "IntelligentTagSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPLIED');

CREATE TABLE "intelligent_tagging_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "trigger" VARCHAR(32) NOT NULL,
    "latency_ms" INTEGER,
    "auto_applied_count" INTEGER NOT NULL DEFAULT 0,
    "pending_review_count" INTEGER NOT NULL DEFAULT 0,
    "model_used" VARCHAR(64),
    "trace_id" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intelligent_tagging_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "intelligent_tag_suggestions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "tag_id" UUID,
    "tag_name" VARCHAR(120) NOT NULL,
    "suggested_new_tag" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "status" "IntelligentTagSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intelligent_tag_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intelligent_tagging_runs_organization_id_created_at_idx" ON "intelligent_tagging_runs"("organization_id", "created_at");
CREATE INDEX "intelligent_tagging_runs_conversation_id_idx" ON "intelligent_tagging_runs"("conversation_id");
CREATE INDEX "intelligent_tag_suggestions_organization_id_status_created_at_idx" ON "intelligent_tag_suggestions"("organization_id", "status", "created_at");
CREATE INDEX "intelligent_tag_suggestions_conversation_id_idx" ON "intelligent_tag_suggestions"("conversation_id");
CREATE INDEX "intelligent_tag_suggestions_run_id_idx" ON "intelligent_tag_suggestions"("run_id");

ALTER TABLE "intelligent_tagging_runs" ADD CONSTRAINT "intelligent_tagging_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelligent_tagging_runs" ADD CONSTRAINT "intelligent_tagging_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelligent_tag_suggestions" ADD CONSTRAINT "intelligent_tag_suggestions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelligent_tag_suggestions" ADD CONSTRAINT "intelligent_tag_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelligent_tag_suggestions" ADD CONSTRAINT "intelligent_tag_suggestions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "intelligent_tagging_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intelligent_tag_suggestions" ADD CONSTRAINT "intelligent_tag_suggestions_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intelligent_tag_suggestions" ADD CONSTRAINT "intelligent_tag_suggestions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
