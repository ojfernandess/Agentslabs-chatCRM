-- Planos personalizados por organização + prazo de pagamento

ALTER TABLE "plans" ADD COLUMN "organization_id" UUID;
ALTER TABLE "plans" ADD COLUMN "is_custom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN "payment_grace_days" INTEGER;

ALTER TABLE "organization_subscriptions" ADD COLUMN "payment_due_at" TIMESTAMP(3);
ALTER TABLE "organization_subscriptions" ADD COLUMN "custom_plan_assigned_at" TIMESTAMP(3);

CREATE INDEX "plans_organization_id_idx" ON "plans"("organization_id");

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
