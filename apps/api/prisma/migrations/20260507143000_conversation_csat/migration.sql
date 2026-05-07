-- CSAT (customer satisfaction) on conversations — OpenConduit reporting step
ALTER TABLE "conversations" ADD COLUMN "csat_score" INTEGER;
ALTER TABLE "conversations" ADD COLUMN "csat_comment" TEXT;
ALTER TABLE "conversations" ADD COLUMN "csat_recorded_at" TIMESTAMP(3);
