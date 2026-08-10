-- Largura da fila de atendimento (split view) em Conversas.
ALTER TABLE "settings"
ADD COLUMN "conversations_split_view_size" VARCHAR(16) NOT NULL DEFAULT 'default';
