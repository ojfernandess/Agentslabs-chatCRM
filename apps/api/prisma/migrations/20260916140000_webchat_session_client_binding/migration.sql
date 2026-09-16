-- Web Chat: vincula o link ao primeiro cliente que abrir (segredo do dispositivo).

ALTER TABLE "webchat_sessions" ADD COLUMN "claimed_at" TIMESTAMP(3);
ALTER TABLE "webchat_sessions" ADD COLUMN "client_session_hash" VARCHAR(64);
