-- AlterTable
ALTER TABLE "wavoip_call_logs" ADD COLUMN "initiated_by_user_id" UUID;
ALTER TABLE "wavoip_call_logs" ADD COLUMN "client_call_id" VARCHAR(128);

-- CreateIndex
CREATE INDEX "wavoip_call_logs_initiated_by_user_id_idx" ON "wavoip_call_logs"("initiated_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wavoip_call_logs_client_call_id_key" ON "wavoip_call_logs"("client_call_id");

-- AddForeignKey
ALTER TABLE "wavoip_call_logs" ADD CONSTRAINT "wavoip_call_logs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
