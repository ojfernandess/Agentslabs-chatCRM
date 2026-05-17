-- Token de verificação Meta (hub.verify_token) — distinto do App Secret (assinatura HMAC).
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "whatsapp_webhook_verify_token" VARCHAR(128);
