-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "ai_alert_webhook_url" VARCHAR(2048),
ADD COLUMN     "ai_alert_webhook_secret" TEXT;
