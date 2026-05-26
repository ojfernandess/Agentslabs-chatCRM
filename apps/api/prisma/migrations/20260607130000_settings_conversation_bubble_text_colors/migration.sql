-- Cores do texto dos balões de conversa (cliente / atendente) — modo claro e escuro
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_client_text_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_text_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_client_text_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_text_color_dark" VARCHAR(7);
