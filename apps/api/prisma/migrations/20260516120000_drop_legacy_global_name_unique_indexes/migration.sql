-- O baseline cria UNIQUE INDEX em `name` (não TABLE CONSTRAINT).
-- A migração multi_tenant usou DROP CONSTRAINT, que não remove esses índices,
-- ficando UNIQUE global e falhando ao criar novas organizações com os mesmos
-- nomes de estágio/tag/tipo de lead.
DROP INDEX IF EXISTS "pipeline_stages_name_key";
DROP INDEX IF EXISTS "tags_name_key";
DROP INDEX IF EXISTS "lead_types_name_key";
-- Mesmo padrão: baseline usou UNIQUE INDEX em contacts.phone.
DROP INDEX IF EXISTS "contacts_phone_key";
