import type { FastifyReply } from "fastify";
import { startOfMonth } from "date-fns";
import { prisma } from "../../db.js";
import { organizationMembersWhere } from "../organizationMemberships.js";
import {
  getEffectivePlanForOrganization,
  resolveLimitValue,
  type EffectivePlanSnapshot,
} from "./PlanEntitlementService.js";
import type { LimitEnforcementMode, PlanFeatures } from "./billingTypes.js";
import { isPlanLimitEnabled, orderPlanLimitKeys } from "./billingTypes.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import { computeOverLimitAmount, enforceUsageLimit } from "./limitEnforcementPolicy.js";

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
  overLimit: number;
  periodStart?: string;
};

export type OrganizationUsageSnapshot = {
  /** Todos os limites definidos no plano (core + personalizados). */
  dimensions: Record<string, DimensionUsage>;
  dimensionOrder: string[];
  enforcement: {
    mode: LimitEnforcementMode;
    overageConfigured: boolean;
  };
};

/** Agentes IA (AutomationAgentProfile) — recurso principal contabilizado em limits.agents. */
async function countAiAgents(organizationId: string): Promise<number> {
  return prisma.automationAgentProfile.count({ where: { organizationId } });
}

/** Membros humanos com papel AGENT na organização. */
async function countHumanAgentSeats(organizationId: string): Promise<number> {
  const membershipCount = await prisma.organizationMembership.count({
    where: { organizationId, role: "AGENT" },
  });
  if (membershipCount > 0) return membershipCount;

  return prisma.user.count({
    where: { organizationId, role: "AGENT" },
  });
}

async function countAgentLimitUsage(organizationId: string): Promise<number> {
  const [aiAgents, humanSeats, pendingInvites] = await Promise.all([
    countAiAgents(organizationId),
    countHumanAgentSeats(organizationId),
    countPendingAgentInvites(organizationId),
  ]);
  return aiAgents + humanSeats + pendingInvites;
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

/** Bots legados / webhooks sem perfil de agente IA (limits.automations). */
async function countAutomations(organizationId: string): Promise<number> {
  return prisma.bot.count({
    where: { organizationId, automationProfile: null },
  });
}

async function countContacts(organizationId: string): Promise<number> {
  return prisma.contact.count({ where: { organizationId } });
}

async function countOrganizationMembers(organizationId: string): Promise<number> {
  return prisma.user.count({
    where: organizationMembersWhere(organizationId),
  });
}

const LIMIT_USAGE_ALIASES: Record<string, string> = {
  utilizadores: "users",
  utilizador: "users",
};

function resolveUsageCountKey(key: string): string {
  return LIMIT_USAGE_ALIASES[key] ?? key;
}

async function buildUsageCounts(organizationId: string): Promise<Record<string, number>> {
  const [aiAgents, automations, contacts, messageStats, humanSeats, members] = await Promise.all([
    countAiAgents(organizationId),
    countAutomations(organizationId),
    countContacts(organizationId),
    countMonthlyMessages(organizationId),
    countHumanAgentSeats(organizationId),
    countOrganizationMembers(organizationId),
  ]);

  return {
    agents: aiAgents,
    automations,
    contacts,
    messages: messageStats.used,
    seats: humanSeats,
    users: members,
    utilizadores: members,
    utilizador: members,
  };
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

function buildEnforcementMeta(settings: Awaited<ReturnType<typeof getBillingPlatformSettings>>) {
  const overageConfigured = Object.values(settings.overage).some(
    (d) => d.enabled && Boolean(d.stripeMeterEventName?.trim()),
  );
  return {
    mode: settings.limitEnforcementMode,
    overageConfigured,
  };
}

export async function getOrganizationUsage(organizationId: string): Promise<OrganizationUsageSnapshot> {
  const [snap, settings, usageCounts, messageStats] = await Promise.all([
    requireSnapshot(organizationId),
    getBillingPlatformSettings(),
    buildUsageCounts(organizationId),
    countMonthlyMessages(organizationId),
  ]);

  const dimensions: Record<string, DimensionUsage> = {};

  for (const [key, limitRaw] of Object.entries(snap.limits)) {
    if (limitRaw === undefined) continue;
    if (!isPlanLimitEnabled(key, snap.limitEnabled)) continue;

    let limit = resolveLimitValue(limitRaw);
    if (key === "messages") {
      limit = await resolveMessageLimit(organizationId, snap);
    }

    const used = usageCounts[resolveUsageCountKey(key)] ?? 0;
    dimensions[key] = {
      used,
      limit,
      overLimit: computeOverLimitAmount(used, limit),
      ...(key === "messages" ? { periodStart: messageStats.periodStart.toISOString() } : {}),
    };
  }

  return {
    dimensions,
    dimensionOrder: orderPlanLimitKeys(Object.keys(dimensions)),
    enforcement: buildEnforcementMeta(settings),
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

/** Novo agente IA (AutomationAgentProfile) — respeita limits.agents. */
function isEnforcedLimit(snap: EffectivePlanSnapshot, key: string): boolean {
  return isPlanLimitEnabled(key, snap.limitEnabled);
}

export async function assertCanAddAiAgents(
  organizationId: string,
  additional = 1,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!isEnforcedLimit(snap, "agents")) return;
  const limit = resolveLimitValue(snap.limits.agents);
  const used = await countAiAgents(organizationId);
  await enforceUsageLimit({
    organizationId,
    dimension: "agents",
    used,
    limit,
    additional,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
  });
}

/** Convites / lugares humanos AGENT — pool partilhado (IA + humanos + convites pendentes). */
export async function assertCanAddAgents(
  organizationId: string,
  additional = 1,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!isEnforcedLimit(snap, "agents")) return;
  const limit = resolveLimitValue(snap.limits.agents);
  const used = await countAgentLimitUsage(organizationId);
  await enforceUsageLimit({
    organizationId,
    dimension: "agents",
    used,
    limit,
    additional,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
  });
}

export async function assertCanAddAutomations(
  organizationId: string,
  additional = 1,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!isEnforcedLimit(snap, "automations")) return;
  const limit = resolveLimitValue(snap.limits.automations);
  const used = await countAutomations(organizationId);
  await enforceUsageLimit({
    organizationId,
    dimension: "automations",
    used,
    limit,
    additional,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
  });
}

export async function assertCanAddContacts(
  organizationId: string,
  additional = 1,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!isEnforcedLimit(snap, "contacts")) return;
  const limit = resolveLimitValue(snap.limits.contacts);
  const used = await countContacts(organizationId);
  await enforceUsageLimit({
    organizationId,
    dimension: "contacts",
    used,
    limit,
    additional,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
  });
}

/** Quota mensal — aplica-se a envios outbound (notas privadas isentas). */
export async function assertCanSendOutboundMessage(
  organizationId: string,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!isEnforcedLimit(snap, "messages")) return;
  const limit = await resolveMessageLimit(organizationId, snap);
  const { used } = await countMonthlyMessages(organizationId);
  await enforceUsageLimit({
    organizationId,
    dimension: "messages",
    used,
    limit,
    additional: 1,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
  });
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
