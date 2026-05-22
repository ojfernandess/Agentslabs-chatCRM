-- Oferecer criação de lembrete ao finalizar atendimento manualmente
ALTER TABLE "settings" ADD COLUMN "resolve_offer_reminder" BOOLEAN NOT NULL DEFAULT true;
