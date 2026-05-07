-- Ingestão HTTP por canal (API, widget, SMS, Telegram, etc.)
-- Usa gen_random_uuid() (PG 13+; inclui postgres:16) — evita gen_random_bytes/pgcrypto.
-- IF NOT EXISTS permite repetir a migração após falha parcial (após migrate resolve --rolled-back).
ALTER TABLE "inboxes" ADD COLUMN IF NOT EXISTS "ingest_token" VARCHAR(64);
ALTER TABLE "inboxes" ADD COLUMN IF NOT EXISTS "channel_config" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "inboxes_ingest_token_key" ON "inboxes"("ingest_token");

UPDATE "inboxes"
SET "ingest_token" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE "ingest_token" IS NULL;
