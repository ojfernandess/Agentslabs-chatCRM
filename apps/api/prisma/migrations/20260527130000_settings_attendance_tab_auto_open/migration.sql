-- Abrir aba Atendimento por defeito quando houver conversas na fila.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "conversations_attendance_tab_auto_open" BOOLEAN NOT NULL DEFAULT true;
