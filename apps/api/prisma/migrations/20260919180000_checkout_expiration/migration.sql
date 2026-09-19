-- Prazo configurável para concluir checkout e plano anterior para revert.
ALTER TABLE "organization_subscriptions"
ADD COLUMN "checkout_previous_plan_id" UUID;
