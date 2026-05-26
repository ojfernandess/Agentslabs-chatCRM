-- Nome do atendente, horário da mensagem (meta) nos balões
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_name_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_name_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_client_meta_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_client_meta_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_meta_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_bubble_agent_meta_color_dark" VARCHAR(7);
