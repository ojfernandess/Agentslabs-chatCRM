-- CSAT: configuração na organização + token de inquérito ao cliente (link único).
ALTER TABLE "settings" ADD COLUMN "csat_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "csat_survey_message" TEXT;

ALTER TABLE "conversations" ADD COLUMN "csat_survey_token" VARCHAR(48);

CREATE UNIQUE INDEX "conversations_csat_survey_token_key" ON "conversations"("csat_survey_token");
