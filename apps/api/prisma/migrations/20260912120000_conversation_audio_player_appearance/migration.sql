-- Reprodutor de áudio nas conversas — cores configuráveis (Aparência).
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_agent_surface_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_agent_accent_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_agent_surface_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_agent_accent_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_client_surface_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_client_accent_color" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_client_surface_color_dark" VARCHAR(7);
ALTER TABLE "settings" ADD COLUMN "conversation_audio_player_client_accent_color_dark" VARCHAR(7);
