-- Default currency for CRM: Brazilian Real (new rows).
ALTER TABLE "products" ALTER COLUMN "currency" SET DEFAULT 'BRL';
ALTER TABLE "deals" ALTER COLUMN "currency" SET DEFAULT 'BRL';
