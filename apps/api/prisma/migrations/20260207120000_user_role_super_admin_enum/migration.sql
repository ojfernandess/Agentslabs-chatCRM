-- Adiciona SUPER_ADMIN ao enum UserRole se ainda não existir.
-- Compatível com PostgreSQL 11+ (evita ADD VALUE IF NOT EXISTS, só disponível no PG 15+).

DO $migrate$
DECLARE
  role_oid oid;
  nsp text;
  typ text;
BEGIN
  SELECT t.oid, n.nspname::text, t.typname::text
  INTO role_oid, nsp, typ
  FROM pg_type t
  INNER JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typtype = 'e'
    AND n.nspname = ANY (current_schemas(true))
    AND (
      t.typname = 'UserRole'
      OR t.typname = 'userrole'
    )
  ORDER BY CASE WHEN t.typname = 'UserRole' THEN 0 ELSE 1 END
  LIMIT 1;

  IF role_oid IS NULL THEN
    RAISE EXCEPTION 'Enum UserRole não encontrado. Aplique primeiro as migrações base.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumtypid = role_oid AND enumlabel = 'SUPER_ADMIN'
  ) THEN
    EXECUTE format('ALTER TYPE %I.%I ADD VALUE %L', nsp, typ, 'SUPER_ADMIN');
  END IF;
END
$migrate$;
