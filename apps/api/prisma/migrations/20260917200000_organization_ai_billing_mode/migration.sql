-- CreateEnum
CREATE TYPE "AiBillingMode" AS ENUM ('OWN_API_KEY', 'PLATFORM_CREDITS');

-- AlterTable
ALTER TABLE "organizations"
ADD COLUMN "ai_billing_mode" "AiBillingMode" NOT NULL DEFAULT 'OWN_API_KEY';
