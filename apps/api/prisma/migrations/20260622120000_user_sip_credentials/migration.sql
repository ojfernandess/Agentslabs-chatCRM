-- Softphone SIP embutido (JsSIP) — credenciais por utilizador
CREATE TABLE IF NOT EXISTS "user_sip_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "sip_user" VARCHAR(64) NOT NULL,
    "sip_password_enc" TEXT NOT NULL,
    "display_name" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sip_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_sip_credentials_user_id_key" ON "user_sip_credentials"("user_id");

DO $$ BEGIN
  ALTER TABLE "user_sip_credentials" ADD CONSTRAINT "user_sip_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
