-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "created_by_id" UUID;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "closure_value" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "contacts_created_by_id_idx" ON "contacts"("created_by_id");
