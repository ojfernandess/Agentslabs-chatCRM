-- Fila de entrada inbound + limiar de alerta de saldo (JSON em external_config)
ALTER TABLE "nvoip_accounts" ADD COLUMN IF NOT EXISTS "external_config" JSONB;
