-- Preferência: mostrar nomes de atendentes nas mensagens (UI).
ALTER TABLE "users" ADD COLUMN "show_agent_name_in_chat" BOOLEAN NOT NULL DEFAULT false;

-- Quem enviou cada mensagem de saída (painel humano).
ALTER TABLE "messages" ADD COLUMN "actor_user_id" UUID;

ALTER TABLE "messages" ADD CONSTRAINT "messages_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messages_actor_user_id_idx" ON "messages"("actor_user_id");
