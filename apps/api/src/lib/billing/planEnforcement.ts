import type { FastifyReply } from "fastify";
import { startOfMonth } from "date-fns";
import { prisma } from "../../db.js";
import { countOrganizationTeamMembers } from "../organizationMemberships.js";
import {
  getEffectivePlanForOrganization,
  resolveLimitValue,
  type EffectivePlanSnapshot,
} from "./PlanEntitlementService.js";
import type { LimitEnforcementMode, PlanFeatures } from "./billingTypes.js";
import { isPlanLimitEnabled, orderPlanLimitKeys } from "./billingTypes.js";
import { getBillingPlatformSettings } from "./billingSettings.js";
import { computeOverLimitAmount, enforceCatalogPlanLimit, enforceUsageLimit } from "./limitEnforcementPolicy.js";

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

async function countPendingTeamInvites(organizationId: string): Promise<number> {
  return prisma.userInvitation.count({
    where: {
      organizationId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

function resolveTeamMemberLimitKey(snap: EffectivePlanSnapshot): string | null {
  if (isEnforcedLimit(snap, "users")) return "users";
  if (isEnforcedLimit(snap, "seats")) return "seats";
  return null;
}

async function countTeamMemberLimitUsage(organizationId: string, limitKey: string): Promise<number> {
  const usageCounts = await buildUsageCounts(organizationId);
  const baseUsed = resolveUsedCountForPlanLimitKey(limitKey, usageCounts);
  const pendingInvites = await countPendingTeamInvites(organizationId);
  return baseUsed + pendingInvites;
}

/** Total de bots da organização — exibido em «Automações / bots» (inclui agentes nativos OpenConduit). */
async function countAllBots(organizationId: string): Promise<number> {
  return prisma.bot.count({ where: { organizationId } });
}

/** Bots legados / webhooks sem perfil de agente IA — enforcement de limits.automations. */
async function countLegacyAutomations(organizationId: string): Promise<number> {
  return prisma.bot.count({
    where: { organizationId, automationProfile: null },
  });
}

async function countContacts(organizationId: string): Promise<number> {
  return prisma.contact.count({ where: { organizationId } });
}

/** Normaliza chaves de limite do plano para lookup de uso (PT/EN, acentos, maiúsculas). */
export function normalizePlanLimitUsageKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s-]+/g, "_");
}

const LIMIT_USAGE_ALIASES: Record<string, string> = {
  users: "users",
  user: "users",
  utilizadores: "users",
  utilizador: "users",
  usuarios: "users",
  usuario: "users",
  seats: "seats",
  seat: "seats",
  lugares: "seats",
  agents: "agents",
  agent: "agents",
  agentes: "agents",
  automations: "automations",
  automation: "automations",
  automacao: "automations",
  automacoes: "automations",
  bots: "automations",
  contacts: "contacts",
  contact: "contacts",
  contatos: "contacts",
  contato: "contacts",
  messages: "messages",
  message: "messages",
  mensagens: "messages",
  mensagem: "messages",
};

export function resolveUsageCountKey(key: string): string {
  const normalized = normalizePlanLimitUsageKey(key);
  return LIMIT_USAGE_ALIASES[normalized] ?? normalized;
}

/** Resolve contagem usada para uma chave de limite do plano (inclui aliases PT/custom). */
export function resolveUsedCountForPlanLimitKey(
  planLimitKey: string,
  usageCounts: Record<string, number>,
): number {
  const canonical = resolveUsageCountKey(planLimitKey);
  if (canonical in usageCounts) return usageCounts[canonical] ?? 0;

  const normalized = normalizePlanLimitUsageKey(planLimitKey);
  if (/^(user|utilizad|usuario|memb|equipe|team)/.test(normalized)) {
    return usageCounts.users ?? 0;
  }
  if (/^(seat|lugar)/.test(normalized)) {
    return usageCounts.seats ?? 0;
  }

  return usageCounts[normalized] ?? 0;
}

async function buildUsageCounts(organizationId: string): Promise<Record<string, number>> {
  const [aiAgents, automations, contacts, messageStats, humanSeats, members] = await Promise.all([
    countAiAgents(organizationId),
    countAllBots(organizationId),
    countContacts(organizationId),
    countMonthlyMessages(organizationId),
    countHumanAgentSeats(organizationId),
    countOrganizationTeamMembers(organizationId),
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
    usuarios: members,
    usuario: members,
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

function planLimitContext(snap: EffectivePlanSnapshot) {
  return { planName: snap.planName, planSlug: snap.planSlug };
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

    const used = resolveUsedCountForPlanLimitKey(key, usageCounts);
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
  if (snap.hasAccess) return;

  throw new PlanEnforcementError(
    "Subscription inactive or payment overdue. Update billing to continue.",
    "billing_access_suspended",
    403,
    {
      subscriptionStatus: snap.subscriptionStatus,
      inGracePeriod: snap.inGracePeriod,
      pendingPlanName: snap.pendingPlanName,
    },
  );
}

export async function assertPlanFeature(
  organizationId: string,
  feature: keyof PlanFeatures,
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  if (!snap.features[feature]) {
    const planLabel = snap.planName?.trim() ? `«${snap.planName.trim()}»` : "seu plano atual";
    throw new PlanEnforcementError(
      `A funcionalidade «${feature}» não está incluída no plano ${planLabel}. ` +
        `Para utilizá-la, faça upgrade do plano em Configurações → Plano e faturação.`,
      "plan_feature_unavailable",
      403,
      {
        feature,
        planSlug: snap.planSlug,
        planName: snap.planName,
        messageEn:
          `The «${feature}» feature is not included in your ${snap.planName?.trim() ? `«${snap.planName.trim()}»` : "current"} plan. ` +
          `Please upgrade your plan in Settings → Billing to use it.`,
        upgradeHint: true,
        upgradePath: "/settings/billing",
      },
    );
  }
}

/** Novo agente IA (AutomationAgentProfile) — respeita limits.agents. */
function isEnforcedLimit(snap: EffectivePlanSnapshot, key: string): boolean {
  return isPlanLimitEnabled(key, snap.limitEnabled);
}

/** Convites e membros humanos — respeita limits.users (ou limits.seats). */
export async function assertCanAddTeamMembers(
  organizationId: string,
  additional = 1,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  await assertOrganizationBillingAccess(organizationId);
  const snap = await requireSnapshot(organizationId);
  const limitKey = resolveTeamMemberLimitKey(snap);
  if (!limitKey) return;
  const limit = resolveLimitValue(snap.limits[limitKey]);
  const used = await countTeamMemberLimitUsage(organizationId, limitKey);
  await enforceCatalogPlanLimit({
    organizationId,
    limitKey,
    used,
    limit,
    additional,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
    planContext: planLimitContext(snap),
  });
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
    planContext: planLimitContext(snap),
  });
}

/** Agentes IA — respeita limits.agents (legado; preferir assertCanAddAiAgents). */
export async function assertCanAddAgents(
  organizationId: string,
  additional = 1,
  options?: { idempotencyKey?: string; actorUserId?: string | null },
): Promise<void> {
  return assertCanAddAiAgents(organizationId, additional, options);
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
  const used = await countLegacyAutomations(organizationId);
  await enforceUsageLimit({
    organizationId,
    dimension: "automations",
    used,
    limit,
    additional,
    idempotencyKey: options?.idempotencyKey,
    actorUserId: options?.actorUserId,
    planContext: planLimitContext(snap),
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
    planContext: planLimitContext(snap),
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
    planContext: planLimitContext(snap),
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
