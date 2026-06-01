-- Ramais SIP sincronizados da Nvoip (/list/users)
CREATE TABLE "nvoip_sip_users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "numbersip" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200),
    "caller" VARCHAR(32),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "webphone" BOOLEAN,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nvoip_sip_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nvoip_sip_users_nvoip_account_id_numbersip_key" ON "nvoip_sip_users"("nvoip_account_id", "numbersip");
CREATE INDEX "nvoip_sip_users_organization_id_idx" ON "nvoip_sip_users"("organization_id");

ALTER TABLE "nvoip_sip_users" ADD CONSTRAINT "nvoip_sip_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_sip_users" ADD CONSTRAINT "nvoip_sip_users_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nvoip_agent_extensions" ADD COLUMN IF NOT EXISTS "nvoip_numbersip" VARCHAR(64);
