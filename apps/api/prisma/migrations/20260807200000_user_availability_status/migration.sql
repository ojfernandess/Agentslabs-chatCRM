-- CreateEnum
CREATE TYPE "UserAvailabilityStatus" AS ENUM ('ONLINE', 'AWAY', 'OFFLINE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "availability_status" "UserAvailabilityStatus" NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "users" ADD COLUMN "availability_updated_at" TIMESTAMP(3);
