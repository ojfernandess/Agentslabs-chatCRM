-- WhatsApp ledger: Meta pricing fields, recipient audit trail, idempotency by provider message id.

ALTER TABLE "message_billing_ledger"
  ADD COLUMN "recipient_phone" VARCHAR(32),
  ADD COLUMN "service_window_open_at_send" BOOLEAN,
  ADD COLUMN "meta_billable" BOOLEAN,
  ADD COLUMN "meta_pricing_type" VARCHAR(48),
  ADD COLUMN "meta_pricing_category" VARCHAR(24),
  ADD COLUMN "meta_pricing_model" VARCHAR(16);

CREATE UNIQUE INDEX "message_billing_ledger_org_provider_msg_uid"
  ON "message_billing_ledger" ("organization_id", "provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;
