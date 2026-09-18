import { recordAuditLog } from "../audit.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BillingAuditAction =
  | "billing.checkout_created"
  | "billing.subscription_created"
  | "billing.plan_changed"
  | "billing.subscription_canceled"
  | "billing.payment_succeeded"
  | "billing.payment_failed"
  | "billing.subscription_suspended"
  | "billing.portal_opened"
  | "billing.payment_method_setup_started"
  | "billing.payment_method_portal_opened"
  | "billing.webhook_processed"
  | "billing.overage_meter_reported"
  | "billing.reminder_sent"
  | "billing.confirmation_email_sent"
  | "billing.ai_credits.checkout_created"
  | "billing.ai_credits.purchase_completed";

export async function recordBillingAudit(input: {
  action: BillingAuditAction;
  organizationId: string;
  actorUserId?: string | null;
  resourceId?: string | null;
  stripeEventId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (input.stripeEventId) metadata.stripeEventId = input.stripeEventId;

  const actorUserId = input.actorUserId?.trim();
  if (!actorUserId || !UUID_RE.test(actorUserId)) return;

  await recordAuditLog({
    actorUserId,
    organizationId: input.organizationId,
    action: input.action,
    resourceType: "billing",
    resourceId: input.resourceId ?? input.organizationId,
    metadata,
    ip: input.ip ?? null,
  });
}
