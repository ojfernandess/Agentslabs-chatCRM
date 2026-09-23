-- Paginação de mensagens por conversa (cursor em conversation_id + created_at).
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
