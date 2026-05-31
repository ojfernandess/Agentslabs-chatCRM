ALTER TABLE "wavoip_devices" ADD COLUMN IF NOT EXISTS "outbound_integrations" JSONB;
