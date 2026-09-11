-- Aceite de Termos de Uso e Política de Privacidade / LGPD por utilizador
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_version" VARCHAR(32);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "privacy_accepted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "privacy_version" VARCHAR(32);
