-- Aba «Atendimento» em Conversas (conversas OPEN à espera de agente).
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "conversations_attendance_tab_enabled" BOOLEAN NOT NULL DEFAULT false;
