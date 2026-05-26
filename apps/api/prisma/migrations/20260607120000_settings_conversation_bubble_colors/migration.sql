-- Cores personalizáveis dos balões de conversa (cliente / atendente) por organização
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_client_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_client_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_color_dark" VARCHAR(7);
