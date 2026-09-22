-- Idempotência de webhooks Stripe por ferramenta de automação (agente / cobrança da org).

CREATE TABLE "automation_stripe_webhook_events" (
    "id" VARCHAR(255) NOT NULL,
    "organization_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "stripe_event_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(120) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "automation_stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_stripe_webhook_events_organization_id_idx" ON "automation_stripe_webhook_events"("organization_id");
CREATE INDEX "automation_stripe_webhook_events_tool_id_idx" ON "automation_stripe_webhook_events"("tool_id");
CREATE UNIQUE INDEX "automation_stripe_webhook_events_tool_stripe_event_key" ON "automation_stripe_webhook_events"("tool_id", "stripe_event_id");
