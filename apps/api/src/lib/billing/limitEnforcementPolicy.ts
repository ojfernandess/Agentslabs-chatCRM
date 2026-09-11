import { getBillingPlatformSettings } from "./billingSettings.js";
import type { UsageDimensionKey } from "./billingTypes.js";
import { PlanEnforcementError } from "./planEnforcement.js";
import { reportOverageMeterEvent } from "./StripeMeterService.js";

function isOverLimit(used: number, limit: number | null, additional = 0): boolean {
  if (limit === null) return false;
  return used + additional > limit;
}

const LIMIT_ERROR_CODES: Record<UsageDimensionKey, string> = {
  agents: "plan_limit_agents",
  automations: "plan_limit_automations",
  contacts: "plan_limit_contacts",
  messages: "plan_limit_messages",
};

const LIMIT_MESSAGES: Record<UsageDimensionKey, string> = {
  agents: "Agent limit reached for current plan",
  automations: "Automation limit reached for current plan",
  contacts: "Contact limit reached for current plan",
  messages: "Monthly message quota reached for current plan",
};

/**
 * Aplica política de limite: bloqueia ou reporta overage ao Stripe Meter.
 * Lança PlanEnforcementError quando a operação não pode continuar.
 */
export async function enforceUsageLimit(input: {
  organizationId: string;
  dimension: UsageDimensionKey;
  used: number;
  limit: number | null;
  additional?: number;
  idempotencyKey?: string;
  actorUserId?: string | null;
}): Promise<{ overage: boolean }> {
  const additional = input.additional ?? 1;
  if (!isOverLimit(input.used, input.limit, additional)) {
    return { overage: false };
  }

  const settings = await getBillingPlatformSettings();
  const code = LIMIT_ERROR_CODES[input.dimension];
  const baseDetails = { used: input.used, limit: input.limit, additional, dimension: input.dimension };

  if (settings.limitEnforcementMode !== "overage") {
    throw new PlanEnforcementError(LIMIT_MESSAGES[input.dimension], code, 402, {
      ...baseDetails,
      enforcementMode: "block",
    });
  }

  const dimConfig = settings.overage[input.dimension];
  if (!dimConfig.enabled || !dimConfig.stripeMeterEventName?.trim()) {
    throw new PlanEnforcementError(
      `${LIMIT_MESSAGES[input.dimension]} (overage billing not configured for this dimension)`,
      code,
      402,
      { ...baseDetails, enforcementMode: "overage", overageConfigured: false },
    );
  }

  const overUnits =
    input.limit === null ? additional : Math.max(additional, input.used + additional - input.limit);

  const report = await reportOverageMeterEvent({
    organizationId: input.organizationId,
    dimension: input.dimension,
    quantity: overUnits,
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
  });

  if (!report.reported) {
    throw new PlanEnforcementError(
      `${LIMIT_MESSAGES[input.dimension]} (could not report overage to Stripe: ${report.reason})`,
      code,
      402,
      {
        ...baseDetails,
        enforcementMode: "overage",
        overageReportError: report.reason,
        overageReportMessage: "message" in report ? report.message : undefined,
      },
    );
  }

  return { overage: true };
}

export function computeOverLimitAmount(used: number, limit: number | null): number {
  if (limit === null) return 0;
  return Math.max(0, used - limit);
}
