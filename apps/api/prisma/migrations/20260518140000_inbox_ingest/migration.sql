-- Ingestão HTTP por canal (API, widget, SMS, Telegram, etc.)
ALTER TABLE "inboxes" ADD COLUMN "ingest_token" VARCHAR(64);
ALTER TABLE "inboxes" ADD COLUMN "channel_config" JSONB;

CREATE UNIQUE INDEX "inboxes_ingest_token_key" ON "inboxes"("ingest_token");

UPDATE "inboxes" SET "ingest_token" = encode(gen_random_bytes(32), 'hex') WHERE "ingest_token" IS NULL;
