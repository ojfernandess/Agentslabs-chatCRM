-- OTP/SMS Nvoip (Fase 5)
CREATE TYPE "NvoipOtpProvider" AS ENUM ('DISABLED', 'NVOIP');

ALTER TABLE "nvoip_accounts" ADD COLUMN "otp_provider" "NvoipOtpProvider" NOT NULL DEFAULT 'DISABLED';
ALTER TABLE "nvoip_accounts" ADD COLUMN "otp_default_channel" VARCHAR(16) NOT NULL DEFAULT 'sms';

CREATE TABLE "nvoip_otp_challenges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "destination" VARCHAR(128) NOT NULL,
    "nvoip_key" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "contact_id" UUID,
    "user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nvoip_otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nvoip_otp_challenges_organization_id_idx" ON "nvoip_otp_challenges"("organization_id");
CREATE INDEX "nvoip_otp_challenges_nvoip_key_idx" ON "nvoip_otp_challenges"("nvoip_key");

ALTER TABLE "nvoip_otp_challenges" ADD CONSTRAINT "nvoip_otp_challenges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_otp_challenges" ADD CONSTRAINT "nvoip_otp_challenges_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_otp_challenges" ADD CONSTRAINT "nvoip_otp_challenges_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nvoip_otp_challenges" ADD CONSTRAINT "nvoip_otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
