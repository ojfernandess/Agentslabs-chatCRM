import { WHATSAPP_SESSION_WINDOW_HOURS } from "@openconduit/shared";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { getMetaPolicyVersions } from "./metaPolicyConfig.js";
import {
  getActiveBillingPolicyPhase,
  getMetaBillingPolicyPhases,
  type MetaBillingPolicyPhase,
} from "./metaBillingPolicy.js";
import {
  estimateWhatsappMessageCost,
  reconcileWhatsappLedgerBillabilityForRange,
} from "./messageBillingLedger.js";
import type { MessageCategory } from "./messagePolicyEngine.js";
import type { MetaPolicyVersions } from "./metaPolicyConfig.js";
import {
  maybeNotifyWhatsappBillableStarted,
  maybeNotifyWhatsappServiceQuota,
} from "./whatsappConsumptionInsights.js";

export const WHATSAPP_CONSUMPTION_CATEGORIES = [
  "SERVICE",
  "UTILITY",
  "MARKETING",
  "AUTHENTICATION",
] as const;

export type WhatsappConsumptionCategory = (typeof WHATSAPP_CONSUMPTION_CATEGORIES)[number];

export type ConsumptionPreset = "today" | "7d" | "30d" | "month" | "custom";

export type ServiceQuotaAlert = {
  threshold: 80 | 100;
  percent: number;
};

/** Intervalo de datas puro — testável sem BD. */
export function resolveConsumptionRange(params: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): { from: Date; to: Date; preset: ConsumptionPreset } {
  const now = params.now ?? new Date();
  const presetRaw = (params.preset ?? "month").toLowerCase();
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  if (presetRaw === "custom" && params.from && params.to) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      return { from: startOfDay(from), to: endOfDay(to), preset: "custom" };
    }
  }

  if (presetRaw === "today") {
    return { from: startOfDay(now), to: endOfDay(now), preset: "today" };
  }
  if (presetRaw === "7d") {
    const from = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    return { from, to: endOfDay(now), preset: "7d" };
  }
  if (presetRaw === "30d") {
    const from = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    return { from, to: endOfDay(now), preset: "30d" };
  }

  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = endOfDay(now);
  return { from, to, preset: "month" };
}

export function calendarMonthRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to: last };
}

/** Alertas internos da franquia Service — só quando quota e uso são valores reais. */
export function buildServiceQuotaAlerts(used: number | null, quota: number | null): ServiceQuotaAlert[] {
  if (used == null || quota == null || quota <= 0) return [];
  const percent = (used / quota) * 100;
  const alerts: ServiceQuotaAlert[] = [];
  if (percent >= 80) alerts.push({ threshold: 80, percent });
  if (percent >= 100) alerts.push({ threshold: 100, percent });
  return alerts;
}

export type CategoryConsumptionRow = {
  category: WhatsappConsumptionCategory;
  sent: number;
  delivered: number;
  failed: number;
  /** null quando não há preço configurado para estimar o que é cobrável. */
  billable: number | null;
  estimatedCost: number | null;
  currency: string | null;
};

type LedgerAggRow = {
  messageCategory: string;
  billingStatus: string;
  currency: string | null;
  metaBillable: boolean | null;
  _count: { _all: number };
  _sum: { estimatedCost: unknown };
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber?: unknown }).toNumber === "function"
  ) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function foldLedgerAggregation(rows: LedgerAggRow[]): CategoryConsumptionRow[] {
  const byCat = new Map<
    WhatsappConsumptionCategory,
    {
      sent: number;
      delivered: number;
      failed: number;
      billable: number;
      estimatedCost: number;
      costSamples: number;
      billableDelivered: number;
      nonBillableDelivered: number;
      currency: string | null;
    }
  >();
  for (const cat of WHATSAPP_CONSUMPTION_CATEGORIES) {
    byCat.set(cat, {
      sent: 0,
      delivered: 0,
      failed: 0,
      billable: 0,
      estimatedCost: 0,
      costSamples: 0,
      billableDelivered: 0,
      nonBillableDelivered: 0,
      currency: null,
    });
  }

  for (const row of rows) {
    const cat = row.messageCategory as WhatsappConsumptionCategory;
    const bucket = byCat.get(cat);
    if (!bucket) continue;
    const count = row._count._all;
    const status = row.billingStatus;
    if (status !== "BLOCKED") bucket.sent += count;
    if (status === "DELIVERED" || status === "READ") {
      bucket.delivered += count;
      if (row.metaBillable === true) bucket.billableDelivered += count;
      else if (row.metaBillable === false) bucket.nonBillableDelivered += count;
    }
    if (status === "FAILED") bucket.failed += count;
    const cost = toNumber(row._sum.estimatedCost);
    if (cost != null && (status === "DELIVERED" || status === "READ")) {
      bucket.estimatedCost += cost;
      bucket.costSamples += count;
      if (cost > 0) bucket.billable += count;
      const rowCurrency = row.currency?.trim().toUpperCase() || null;
      if (rowCurrency) {
        if (!bucket.currency) bucket.currency = rowCurrency;
        else if (bucket.currency !== rowCurrency) bucket.currency = null;
      }
    }
  }

  return WHATSAPP_CONSUMPTION_CATEGORIES.map((category) => {
    const b = byCat.get(category)!;
    const hasBillabilitySignal = b.billableDelivered + b.nonBillableDelivered > 0;
    let billable: number | null = null;
    let estimatedCost: number | null = null;
    let currency: string | null = null;

    if (b.costSamples > 0) {
      billable = b.billableDelivered > 0 ? b.billableDelivered : b.billable;
      estimatedCost = b.estimatedCost;
      currency = b.currency;
    } else if (hasBillabilitySignal) {
      billable = b.billableDelivered;
      estimatedCost = b.billableDelivered > 0 ? null : 0;
      currency = null;
    }

    return {
      category,
      sent: b.sent,
      delivered: b.delivered,
      failed: b.failed,
      billable,
      estimatedCost,
      currency,
    };
  });
}

/**
 * Uso da franquia mensal Service: mensagens entregues no mês.
 * `billable` é só o que a Meta cobra por cima da franquia — não o consumo da quota.
 */
export function resolveServiceQuotaUsed(
  serviceRow: Pick<CategoryConsumptionRow, "delivered"> | undefined,
): number {
  return serviceRow?.delivered ?? 0;
}

/** Franquia Service para UI — platform setting → fase vigente → primeira fase com tier definido. */
export function resolveServiceFreeQuotaForDisplay(
  versions: Pick<MetaPolicyVersions, "serviceFreeMessagesPerNumberPerMonth">,
  activePhase: MetaBillingPolicyPhase,
  phases: MetaBillingPolicyPhase[],
): number | null {
  if (versions.serviceFreeMessagesPerNumberPerMonth != null) {
    return versions.serviceFreeMessagesPerNumberPerMonth;
  }
  if (activePhase.serviceFreeTierPerNumberPerMonth != null) {
    return activePhase.serviceFreeTierPerNumberPerMonth;
  }
  for (const phase of phases) {
    if (phase.serviceFreeTierPerNumberPerMonth != null) {
      return phase.serviceFreeTierPerNumberPerMonth;
    }
  }
  return null;
}

async function sampleRecipientPhoneForOrg(organizationId: string, from: Date, to: Date): Promise<string | null> {
  const row = await prisma.messageBillingLedgerEntry.findFirst({
    where: {
      organizationId,
      channel: "WHATSAPP",
      sentAt: { gte: from, lte: to },
      recipientPhone: { not: null },
    },
    orderBy: { sentAt: "desc" },
    select: { recipientPhone: true },
  });
  const phone = row?.recipientPhone?.replace(/[^0-9]/g, "");
  return phone && phone.length >= 8 ? phone : null;
}

/** Preenche custo estimado agregado quando o ledger já tem metaBillable mas sem unit price (máx. 4 lookups). */
export async function enrichConsumptionEstimatedCosts(
  organizationId: string,
  rows: CategoryConsumptionRow[],
  range: { from: Date; to: Date },
): Promise<CategoryConsumptionRow[]> {
  const needsEnrich = rows.some(
    (row) => row.billable != null && row.billable > 0 && row.estimatedCost == null,
  );
  if (!needsEnrich) return rows;

  const phone =
    (await sampleRecipientPhoneForOrg(organizationId, range.from, range.to)) ?? "5511999999999";
  const at = range.to;

  const out: CategoryConsumptionRow[] = [];
  for (const row of rows) {
    if (row.billable == null || row.billable <= 0 || row.estimatedCost != null) {
      out.push(row);
      continue;
    }
    const est = await estimateWhatsappMessageCost({
      organizationId,
      recipientPhone: phone,
      category: row.category as MessageCategory,
      at,
      isTemplate: false,
      serviceWindowOpenAtSend: false,
    });
    const unit = est.estimatedCost != null ? Number(est.estimatedCost) : null;
    out.push({
      ...row,
      estimatedCost: unit != null ? unit * row.billable : null,
      currency: est.currency ?? row.currency,
    });
  }
  return out;
}

export async function getWhatsappConsumption(params: {
  organizationId: string;
  from: Date;
  to: Date;
}): Promise<CategoryConsumptionRow[]> {
  await reconcileWhatsappLedgerBillabilityForRange({
    organizationId: params.organizationId,
    from: params.from,
    to: params.to,
  });
  const rows = await prisma.messageBillingLedgerEntry.groupBy({
    by: ["messageCategory", "billingStatus", "currency", "metaBillable"],
    where: {
      organizationId: params.organizationId,
      channel: "WHATSAPP",
      sentAt: { gte: params.from, lte: params.to },
      messageCategory: { in: [...WHATSAPP_CONSUMPTION_CATEGORIES] },
    },
    _count: { _all: true },
    _sum: { estimatedCost: true },
  });
  const folded = foldLedgerAggregation(rows);
  const result = await enrichConsumptionEstimatedCosts(params.organizationId, folded, {
    from: params.from,
    to: params.to,
  });
  void maybeNotifyWhatsappBillableStarted(params.organizationId).catch(() => {});
  return result;
}

export type WhatsappPolicyOverview = {
  customerServiceWindowHours: number;
  serviceFreeMessagesPerNumberPerMonth: number | null;
  billingActive: boolean;
  messagePolicyActive: boolean;
  serviceUsed: number | null;
  serviceRemaining: number | null;
  periodStart: string;
  periodEnd: string;
  source: string | null;
  alerts: ServiceQuotaAlert[];
};

export async function getWhatsappPolicyOverview(organizationId: string): Promise<WhatsappPolicyOverview> {
  const versions = await getMetaPolicyVersions();
  const phases = await getMetaBillingPolicyPhases();
  const activePhase = await getActiveBillingPolicyPhase();
  const quota = resolveServiceFreeQuotaForDisplay(versions, activePhase, phases);
  const [billingActive, messagePolicyActive] = await Promise.all([
    isOrganizationFeatureEnabled(organizationId, "cost_aware_messaging"),
    isOrganizationFeatureEnabled(organizationId, "whatsapp_message_policy"),
  ]);
  const { from, to } = calendarMonthRange();
  let serviceUsed: number | null = null;
  try {
    const rows = await getWhatsappConsumption({ organizationId, from, to });
    const serviceRow = rows.find((r) => r.category === "SERVICE");
    serviceUsed = resolveServiceQuotaUsed(serviceRow);
  } catch {
    serviceUsed = null;
  }
  const remaining =
    quota != null && serviceUsed != null ? Math.max(0, quota - serviceUsed) : null;
  const alerts = buildServiceQuotaAlerts(serviceUsed, quota);
  void maybeNotifyWhatsappServiceQuota({ organizationId, alerts }).catch(() => {});
  return {
    customerServiceWindowHours: WHATSAPP_SESSION_WINDOW_HOURS,
    serviceFreeMessagesPerNumberPerMonth: quota,
    billingActive,
    messagePolicyActive,
    serviceUsed,
    serviceRemaining: remaining,
    periodStart: from.toISOString(),
    periodEnd: to.toISOString(),
    source: versions.source || null,
    alerts,
  };
}
