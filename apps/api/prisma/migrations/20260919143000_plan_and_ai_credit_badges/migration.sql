-- Optional marketing badges for subscription plans and AI credit packages.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "badge_label" VARCHAR(80);

ALTER TABLE "ai_credit_packages" ADD COLUMN IF NOT EXISTS "badge_label" VARCHAR(80);
