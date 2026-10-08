-- Distribuição de chamadas SIP: presença do softphone e histórico das ofertas.
CREATE TABLE IF NOT EXISTS "sip_agent_presence" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sip_agent_presence_pkey" PRIMARY KEY ("user_id")
);

CREATE INDEX IF NOT EXISTS "sip_agent_presence_organization_id_state_updated_at_idx"
  ON "sip_agent_presence"("organization_id", "state", "updated_at");

DO $$ BEGIN
  ALTER TABLE "sip_agent_presence" ADD CONSTRAINT "sip_agent_presence_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sip_agent_presence" ADD CONSTRAINT "sip_agent_presence_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "sip_call_distributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "caller_digits" VARCHAR(32) NOT NULL,
    "sip_call_id" VARCHAR(256) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "offered_count" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sip_call_distributions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sip_call_distributions_organization_id_caller_digits_offered_at_idx"
  ON "sip_call_distributions"("organization_id", "caller_digits", "offered_at");

CREATE INDEX IF NOT EXISTS "sip_call_distributions_organization_id_user_id_offered_at_idx"
  ON "sip_call_distributions"("organization_id", "user_id", "offered_at");

CREATE INDEX IF NOT EXISTS "sip_call_distributions_organization_id_status_idx"
  ON "sip_call_distributions"("organization_id", "status");

DO $$ BEGIN
  ALTER TABLE "sip_call_distributions" ADD CONSTRAINT "sip_call_distributions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "sip_call_distributions" ADD CONSTRAINT "sip_call_distributions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
