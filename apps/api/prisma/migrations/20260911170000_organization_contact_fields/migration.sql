-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "contact_email" VARCHAR(255),
ADD COLUMN "phone" VARCHAR(32),
ADD COLUMN "address" TEXT,
ADD COLUMN "cnpj" VARCHAR(18);
