-- AlterTable: OpenAI opcional por organização (assistência no painel — IA & Insights).
ALTER TABLE "settings" ADD COLUMN "assistant_openai_api_key" TEXT;
ALTER TABLE "settings" ADD COLUMN "assistant_openai_api_base_url" VARCHAR(512);
