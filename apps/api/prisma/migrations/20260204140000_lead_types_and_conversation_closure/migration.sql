-- CreateTable
CREATE TABLE "lead_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_types_name_key" ON "lead_types"("name");

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "lead_type_id" UUID,
ADD COLUMN "closure_reason" TEXT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_type_id_fkey" FOREIGN KEY ("lead_type_id") REFERENCES "lead_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tipos de lead padrão (pt-BR)
INSERT INTO "lead_types" ("name", "color", "sort_order") VALUES
('MQL — lead de marketing', '#6366f1', 0),
('SQL — lead de vendas', '#3b82f6', 1),
('Oportunidade', '#f59e0b', 2),
('Fechado — ganho', '#10b981', 3),
('Fechado — perdido', '#ef4444', 4),
('Suporte / relacionamento', '#8b5cf6', 5);

-- Atualiza funil / tags legados em inglês para pt-BR (idempotente se já migrado)
UPDATE "pipeline_stages" SET "name" = 'Novo lead' WHERE "name" = 'New Lead';
UPDATE "pipeline_stages" SET "name" = 'Em atendimento' WHERE "name" = 'Contacted';
UPDATE "pipeline_stages" SET "name" = 'Proposta enviada' WHERE "name" = 'Proposal Sent';
UPDATE "pipeline_stages" SET "name" = 'Convertido' WHERE "name" = 'Converted';
UPDATE "pipeline_stages" SET "name" = 'Encerrado' WHERE "name" = 'Closed';

UPDATE "tags" SET "name" = 'Novo lead' WHERE "name" = 'New Lead';
UPDATE "tags" SET "name" = 'Interessado' WHERE "name" = 'Interested';
UPDATE "tags" SET "name" = 'Teste realizado' WHERE "name" = 'Trial Done';
UPDATE "tags" SET "name" = 'Convertido' WHERE "name" = 'Converted';
UPDATE "tags" SET "name" = 'Cancelado / churn' WHERE "name" = 'Churned';
UPDATE "tags" SET "name" = 'Desconhecido' WHERE "name" = 'Unknown';
