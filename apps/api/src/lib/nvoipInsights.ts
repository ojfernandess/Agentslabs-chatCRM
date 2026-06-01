import { prisma } from "../db.js";
import { nvoipGetBalance, nvoipListRates, type NvoipRateItem } from "./nvoipClient.js";
import { requireConnectedNvoipAccount } from "./nvoipSms.js";

function parseRateNumber(value: string): number | null {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function estimateCostFromRates(
  totalDurationSec: number,
  rates: NvoipRateItem[],
): { estimatedBrl: number | null; ratePerMinuteUsed: number | null } {
  if (totalDurationSec <= 0 || rates.length === 0) {
    return { estimatedBrl: null, ratePerMinuteUsed: null };
  }

  const perMinute: number[] = [];
  for (const r of rates) {
    const n = parseRateNumber(r.value);
    if (n == null) continue;
    const unit = (r.unit ?? r.label).toLowerCase();
    if (unit.includes("min") || unit.includes("minuto")) {
      perMinute.push(n);
    } else if (n < 2) {
      perMinute.push(n);
    }
  }

  const rate =
    perMinute.length > 0
      ? perMinute.reduce((a, b) => a + b, 0) / perMinute.length
      : parseRateNumber(rates[0]!.value);

  if (rate == null) return { estimatedBrl: null, ratePerMinuteUsed: null };

  const minutes = totalDurationSec / 60;
  return {
    estimatedBrl: Math.round(minutes * rate * 100) / 100,
    ratePerMinuteUsed: rate,
  };
}

export async function buildNvoipOrgInsights(
  organizationId: string,
  periodDays = 30,
): Promise<{
  periodDays: number;
  accountStatus: string | null;
  balance: string | null;
  calls: {
    total: number;
    inbound: number;
    outbound: number;
    totalDurationSec: number;
  };
  torpedoDispatches: number;
  integrationEvents: { sms: number; errors: number; total: number };
  rates: NvoipRateItem[];
  estimatedCostBrl: number | null;
  ratePerMinuteUsed: number | null;
}> {
  const since = new Date(Date.now() - periodDays * 86_400_000);

  const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });

  const [callAgg, inbound, outbound, torpedoDispatches, smsEvents, errorEvents] =
    await Promise.all([
      prisma.nvoipCallLog.aggregate({
        where: { organizationId, createdAt: { gte: since } },
        _sum: { durationSec: true },
        _count: { id: true },
      }),
      prisma.nvoipCallLog.count({
        where: { organizationId, createdAt: { gte: since }, direction: "INBOUND" },
      }),
      prisma.nvoipCallLog.count({
        where: { organizationId, createdAt: { gte: since }, direction: "OUTBOUND" },
      }),
      prisma.nvoipTorpedoDispatch.count({
        where: { organizationId, createdAt: { gte: since } },
      }),
      prisma.nvoipIntegrationLog.count({
        where: { organizationId, createdAt: { gte: since }, eventType: "sms_sent" },
      }),
      prisma.nvoipIntegrationLog.count({
        where: { organizationId, createdAt: { gte: since }, level: "error" },
      }),
    ]);

  const totalDurationSec = callAgg._sum.durationSec ?? 0;
  const callsTotal = callAgg._count.id;

  let rates: NvoipRateItem[] = [];
  let balance: string | null = account?.lastBalance ?? null;
  let estimatedCostBrl: number | null = null;
  let ratePerMinuteUsed: number | null = null;

  if (account?.status === "CONNECTED") {
    try {
      rates = await nvoipListRates(account);
      const est = estimateCostFromRates(totalDurationSec, rates);
      estimatedCostBrl = est.estimatedBrl;
      ratePerMinuteUsed = est.ratePerMinuteUsed;
    } catch {
      /* rates optional */
    }
    try {
      const bal = await nvoipGetBalance(account);
      balance = bal.balance;
    } catch {
      /* keep cached balance */
    }
  }

  return {
    periodDays,
    accountStatus: account?.status ?? null,
    balance,
    calls: {
      total: callsTotal,
      inbound,
      outbound,
      totalDurationSec,
    },
    torpedoDispatches,
    integrationEvents: {
      sms: smsEvents,
      errors: errorEvents,
      total: await prisma.nvoipIntegrationLog.count({
        where: { organizationId, createdAt: { gte: since } },
      }),
    },
    rates: rates.slice(0, 25),
    estimatedCostBrl,
    ratePerMinuteUsed,
  };
}

export async function buildNvoipPlatformMetrics(periodDays = 30): Promise<{
  periodDays: number;
  organizationsWithAccount: number;
  connectedAccounts: number;
  calls: { total: number; totalDurationSec: number };
  torpedoDispatches: number;
  estimatedCostBrl: number | null;
  topOrganizations: {
    organizationId: string;
    organizationName: string;
    callCount: number;
    durationSec: number;
  }[];
}> {
  const since = new Date(Date.now() - periodDays * 86_400_000);

  const accounts = await prisma.nvoipAccount.findMany({
    select: {
      organizationId: true,
      status: true,
      organization: { select: { name: true } },
    },
  });

  const [callAgg, torpedoDispatches, byOrg] = await Promise.all([
    prisma.nvoipCallLog.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { durationSec: true },
      _count: { id: true },
    }),
    prisma.nvoipTorpedoDispatch.count({ where: { createdAt: { gte: since } } }),
    prisma.nvoipCallLog.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      _sum: { durationSec: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
  ]);

  const orgNameById = new Map(accounts.map((a) => [a.organizationId, a.organization.name]));

  const topOrganizations = byOrg.map((row) => ({
    organizationId: row.organizationId,
    organizationName: orgNameById.get(row.organizationId) ?? row.organizationId,
    callCount: row._count.id,
    durationSec: row._sum.durationSec ?? 0,
  }));

  let estimatedCostBrl: number | null = null;
  const sampleConnected = accounts.find((a) => a.status === "CONNECTED");
  if (sampleConnected && (callAgg._sum.durationSec ?? 0) > 0) {
    try {
      const account = await requireConnectedNvoipAccount(sampleConnected.organizationId);
      const rates = await nvoipListRates(account);
      estimatedCostBrl = estimateCostFromRates(
        callAgg._sum.durationSec ?? 0,
        rates,
      ).estimatedBrl;
    } catch {
      estimatedCostBrl = null;
    }
  }

  return {
    periodDays,
    organizationsWithAccount: accounts.length,
    connectedAccounts: accounts.filter((a) => a.status === "CONNECTED").length,
    calls: {
      total: callAgg._count.id,
      totalDurationSec: callAgg._sum.durationSec ?? 0,
    },
    torpedoDispatches,
    estimatedCostBrl,
    topOrganizations,
  };
}
