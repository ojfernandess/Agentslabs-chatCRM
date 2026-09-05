-- Permite trigger "during_conversation" (19 chars) nas definições de etiquetagem inteligente
ALTER TABLE "settings"
  ALTER COLUMN "intelligent_tagging_trigger" TYPE VARCHAR(32);
