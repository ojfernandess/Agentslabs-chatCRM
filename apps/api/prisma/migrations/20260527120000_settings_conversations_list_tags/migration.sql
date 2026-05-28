-- Mostrar etiquetas do contacto na lista de conversas (opcional por organização).
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "conversations_list_show_contact_tags" BOOLEAN NOT NULL DEFAULT false;
