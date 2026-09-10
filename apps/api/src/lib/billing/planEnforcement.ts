import type { FastifyReply } from "fastify";
import { startOfMonth } from "date-fns";
import { prisma } from "../../db.js";
import {
  getEffectivePlanForOrganization,
  resolveLimitValue,
  type EffectivePlanSnapshot,
} from "./PlanEntitlementService.js";
import type { PlanFeatures } from "./billingTypes.js";

export class PlanEnforcementError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number = 402,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlanEnforcementError";
  }
}

export type UsageDimension = "agents" | "automations" | "contacts" | "messages";

export type DimensionUsage = {
  used: number;
  limit: number | null;
};

export type OrganizationUsageSnapshot = {
  agents: DimensionUsage;
  automations: DimensionUsage;
  contacts: DimensionUsage;
  messages: DimensionUsage & { periodStart: string };
};

function isOverLimit(used: number, limit: number | null, additional = 0): boolean {
  if (limit === null) return false;
  return used + additional > limit;
}

async function countAgents(organizationId: string): Promise<number> {
  const membershipCount = await prisma.organizationMembership.count({
    where: { organizationId, role: "AGENT" },
  });
  if (membershipCount > 0) return membershipCount;

  return prisma.user.count({
    where: { organizationId, role: "AGENT" },
  });
}

async function countPendingAgentInvites(organizationId: string): Promise<number> {
  return prisma.userInvitation.count({
    where: {
      organizationId,
      role: "AGENT",
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

async function countAutomations(organizationId: string): Promise<number> {
  return prisma.bot.count({ where: { organizationId } });
}

async function countContacts(organizationId: string): Promise<number> {
  return prisma.contact.count({ where: { organizationId } });
}

async function countMonthlyMessages(organizationId: string): Promise<{ used: number; periodStart: Date }> {
  const periodStart = startOfMonth(new Date());
  const used = await prisma.message.count({
    where: {
      isPrivate: false,
      createdAt: { gte: periodStart },
      conversation: { organizationId },
    },
  });
  return { used, periodStart };
}

async function resolveMessageLimit(
  organizationId: string,
  snap: EffectivePlanSnapshot,
): Promise<number | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { monthlyMessageQuota: true },
  });
  if (org?.monthlyMessageQuota != null) return org.monthlyMessageQuota;
  return resolveLimitValue(snap.limits.messages);
}

async function requireSnapshot(organizationId: string): Promise<EffectivePlanSnapshot> {
  const snap = await getEffectivePlanForOrganization(organizationId);
  if (!snap) {
    throw new PlanEnforcementError("Organization not found", "org_not_found", 404);
  }
  return snap;
}

export async function getOrganizationUsage(organizationId: string): Promise<OrganizationUsageSnapshot> {
  const snap = await requireSnapshot(organizationId);
  const [agentsUsed, pendingInvites, automationsUsed, contactsUsed, messageStats] = await Promise.all([
    countAgents(organizationId),
    countPendingAgentInvites(organizationId),
    countAutomations(organizationId),
    countContacts(organizationId),
    countMonthlyMessages(organizationId),
  ]);

  const messageLimit = await resolveMessageLimit(organizationId, snap);

  return {
    agents: {
      used: agentsUsed + pendingInvites,
      limit: resolveLimitValue(snap.limits.agents),
    },
    automations: {
      used: automationsUsed,
      limit: resolveLimitValue(snap.limits.automations),
    },
    contacts: {
      used: contactsUsed,
      limit: resolveLimitValue(snap.limits.contacts),
    },
    messages: {
      used: messageStats.used,
      limit: messageLimit,
      periodStart: messageStats.periodStart.toISOString(),
    },
  };
}

/** Bloqueia operações quando assinatura expirou (fora de grace period). */
export async function assertOrganizationBillingAccess(organizationId: string): Promise<void> {
  const snap = await requireSnapshot(organizationId);
  if (!snap.hasAccess) {
    throw new PlanEnforcementError(
      "Subscription inactive or payment overdue. Update billing to continue.",
      "billing_access_suspended",
      403,
      { subscriptionStatus: snap.subscriptionStatus, inGracePeriod: snap.inGracePeriod },
    );
  }
}

export async function assertPlanFeature(
  organizationId: string,
  feature: keyof PlanFeatures,
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!snap.features[feature]) {
    throw new PlanEnforcementError(
      `Feature not included in current plan: ${feature}`,
      "plan_feature_unavailable",
      403,
      { feature, planSlug: snap.planSlug },
    );
  }
}

export async function assertCanAddAgents(
  organizationId: string,
  additional = 1,
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  const limit = resolveLimitValue(snap.limits.agents);
  const [used, pending] = await Promise.all([
    countAgents(organizationId),
    countPendingAgentInvites(organizationId),
  ]);
  if (isOverLimit(used + pending, limit, additional)) {
    throw new PlanEnforcementError(
      "Agent limit reached for current plan",
      "plan_limit_agents",
      402,
      { used: used + pending, limit, additional },
    );
  }
}

export async function assertCanAddAutomations(
  organizationId: string,
  additional = 1,
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  const limit = resolveLimitValue(snap.limits.automations);
  const used = await countAutomations(organizationId);
  if (isOverLimit(used, limit, additional)) {
    throw new PlanEnforcementError(
      "Automation limit reached for current plan",
      "plan_limit_automations",
      402,
      { used, limit, additional },
    );
  }
}

export async function assertCanAddContacts(
  organizationId: string,
  additional = 1,
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  const limit = resolveLimitValue(snap.limits.contacts);
  const used = await countContacts(organizationId);
  if (isOverLimit(used, limit, additional)) {
    throw new PlanEnforcementError(
      "Contact limit reached for current plan",
      "plan_limit_contacts",
      402,
      { used, limit, additional },
    );
  }
}

/** Quota mensal — aplica-se a envios outbound (notas privadas isentas). */
export async function assertCanSendOutboundMessage(organizationId: string): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  const limit = await resolveMessageLimit(organizationId, snap);
  const { used } = await countMonthlyMessages(organizationId);
  if (isOverLimit(used, limit, 1)) {
    throw new PlanEnforcementError(
      "Monthly message quota reached for current plan",
      "plan_limit_messages",
      402,
      { used, limit },
    );
  }
}

export function replyPlanEnforcementError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof PlanEnforcementError) {
    reply.status(err.statusCode).send({
      error: err.code,
      message: err.message,
      statusCode: err.statusCode,
      details: err.details,
    });
    return true;
  }
  return false;
}
