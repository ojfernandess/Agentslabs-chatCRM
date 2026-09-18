import { getBillingPlatformSettings } from "./billingSettings.js";
import type { UsageDimensionKey } from "./billingTypes.js";
import { buildPlanLimitExceededDetails, buildPlanLimitExceededMessages } from "./planLimitErrorMessages.js";
import { PlanEnforcementError, resolveUsageCountKey } from "./planEnforcement.js";
import { reportOverageMeterEvent } from "./StripeMeterService.js";

export type PlanLimitEnforcementContext = {
  planName: string | null;
  planSlug?: string | null;
};

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

const CATALOG_LIMIT_ERROR_CODES: Record<string, string> = {
  users: "plan_limit_users",
  seats: "plan_limit_seats",
  ...LIMIT_ERROR_CODES,
};

function resolveLimitErrorCode(limitKey: string): string {
  const canonical = resolveUsageCountKey(limitKey);
  return CATALOG_LIMIT_ERROR_CODES[canonical] ?? `plan_limit_${canonical}`;
}

function resolveLimitExceededPayload(input: {
  dimension: string;
  used: number;
  limit: number;
  additional: number;
  planContext?: PlanLimitEnforcementContext;
}): { message: string; details: Record<string, unknown> } {
  const planName = input.planContext?.planName ?? null;
  const messages = buildPlanLimitExceededMessages({
    planName,
    dimension: input.dimension,
    used: input.used,
    limit: input.limit,
    additional: input.additional,
  });
  const details = buildPlanLimitExceededDetails({
    planName,
    dimension: input.dimension,
    used: input.used,
    limit: input.limit,
    additional: input.additional,
  });
  if (input.planContext?.planSlug) {
    details.planSlug = input.planContext.planSlug;
  }
  return { message: messages.message, details };
}

async function enforceLimitCore(input: {
  organizationId: string;
  dimension: string;
  used: number;
  limit: number | null;
  additional?: number;
  idempotencyKey?: string;
  actorUserId?: string | null;
  planContext?: PlanLimitEnforcementContext;
}): Promise<{ overage: boolean }> {
  const additional = input.additional ?? 1;
  if (!isOverLimit(input.used, input.limit, additional)) {
    return { overage: false };
  }

  const settings = await getBillingPlatformSettings();
  const code = resolveLimitErrorCode(input.dimension);
  const limit = input.limit as number;
  const { message, details: limitDetails } = resolveLimitExceededPayload({
    dimension: input.dimension,
    used: input.used,
    limit,
    additional,
    planContext: input.planContext,
  });
  const baseDetails = { ...limitDetails, enforcementMode: "block" as const };

  if (settings.limitEnforcementMode !== "overage") {
    throw new PlanEnforcementError(message, code, 402, baseDetails);
  }

  const dimConfig = settings.overage[input.dimension];
  if (!dimConfig?.enabled || !dimConfig.stripeMeterEventName?.trim()) {
    throw new PlanEnforcementError(message, code, 402, {
      ...baseDetails,
      enforcementMode: "overage",
      overageConfigured: false,
    });
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
    throw new PlanEnforcementError(message, code, 402, {
      ...baseDetails,
      enforcementMode: "overage",
      overageReportError: report.reason,
      overageReportMessage: "message" in report ? report.message : undefined,
    });
  }

  return { overage: true };
}

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
  planContext?: PlanLimitEnforcementContext;
}): Promise<{ overage: boolean }> {
  return enforceLimitCore(input);
}

/** Limites de catálogo (ex.: users, seats) com a mesma política block/overage. */
export async function enforceCatalogPlanLimit(input: {
  organizationId: string;
  limitKey: string;
  used: number;
  limit: number | null;
  additional?: number;
  idempotencyKey?: string;
  actorUserId?: string | null;
  planContext?: PlanLimitEnforcementContext;
}): Promise<{ overage: boolean }> {
  return enforceLimitCore({ ...input, dimension: input.limitKey });
}

export function computeOverLimitAmount(used: number, limit: number | null): number {
  if (limit === null) return 0;
  return Math.max(0, used - limit);
}
