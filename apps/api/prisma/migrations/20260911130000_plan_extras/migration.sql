-- Campos textuais configuráveis por plano (suporte, SLA, etc.)
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "plan_extras" JSONB NOT NULL DEFAULT '{}';
