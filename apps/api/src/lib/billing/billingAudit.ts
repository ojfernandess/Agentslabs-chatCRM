import { recordAuditLog } from "../audit.js";

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
  | "billing.webhook_processed";

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

  await recordAuditLog({
    actorUserId: input.actorUserId ?? "system",
    organizationId: input.organizationId,
    action: input.action,
    resourceType: "billing",
    resourceId: input.resourceId ?? input.organizationId,
    metadata,
    ip: input.ip ?? null,
  });
}
