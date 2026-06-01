CREATE TABLE "nvoip_trunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "nvoip_account_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "default_caller" VARCHAR(32) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nvoip_trunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nvoip_trunks_nvoip_account_id_name_key" ON "nvoip_trunks"("nvoip_account_id", "name");
CREATE INDEX "nvoip_trunks_organization_id_idx" ON "nvoip_trunks"("organization_id");

ALTER TABLE "nvoip_trunks" ADD CONSTRAINT "nvoip_trunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nvoip_trunks" ADD CONSTRAINT "nvoip_trunks_nvoip_account_id_fkey" FOREIGN KEY ("nvoip_account_id") REFERENCES "nvoip_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
