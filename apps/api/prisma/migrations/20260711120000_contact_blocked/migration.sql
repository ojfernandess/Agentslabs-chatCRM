ALTER TABLE "contacts" ADD COLUMN "is_blocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contacts" ADD COLUMN "blocked_at" TIMESTAMP(3);
