import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { money, moneyToApiString } from "../ai-billing/money.js";
import {
  fetchOpenAiCompletionsUsage,
  fetchOpenAiOrganizationCosts,
  OpenAiAdminApiError,
  testOpenAiAdminConnection,
  type OpenAiCostBucket,
  type OpenAiUsageBucket,
} from "./openAiAdminClient.js";
import { getOpenAiAdminSettingsFromDb, resolveOpenAiAdminApiKey } from "./openAiAdminSettings.js";

const SYNC_LOOKBACK_DAYS = 365;

export type OpenAiNormalizedDailyCost = {
  date: string;
  amountUsd: number;
  categories: Record<string, number>;
  projects: Record<string, number>;
};

export type OpenAiNormalizedUsageDay = {
  date: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requests: number;
  projectId: string | null;
};

export type OpenAiSyncPayload = {
  costsLineItem: OpenAiCostBucket[];
  costsProject: OpenAiCostBucket[];
  usage: OpenAiUsageBucket[];
  normalized: {
    dailyCosts: OpenAiNormalizedDailyCost[];
    usageDays: OpenAiNormalizedUsageDay[];
    projectTotals: Record<string, number>;
  };
};

function parseAmountUsd(amount?: { value?: string; currency?: string }): number {
  const value = Number.parseFloat(String(amount?.value ?? "0"));
  return Number.isFinite(value) ? value : 0;
}

function bucketDateKey(startTime?: number): string {
  if (!startTime) return "unknown";
  return new Date(startTime * 1000).toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function normalizeOpenAiSyncPayload(
  costsLineItem: OpenAiCostBucket[],
  costsProject: OpenAiCostBucket[],
  usage: OpenAiUsageBucket[],
): OpenAiSyncPayload["normalized"] {
  const dailyMap = new Map<string, OpenAiNormalizedDailyCost>();
  const projectTotals: Record<string, number> = {};

  for (const bucket of costsLineItem) {
    const date = bucketDateKey(bucket.start_time);
    const entry =
      dailyMap.get(date) ??
      ({
        date,
        amountUsd: 0,
        categories: {},
        projects: {},
      } satisfies OpenAiNormalizedDailyCost);

    for (const result of bucket.results ?? []) {
      const usd = parseAmountUsd(result.amount);
      entry.amountUsd += usd;

      const lineItem = result.line_item?.trim() || "other";
      entry.categories[lineItem] = (entry.categories[lineItem] ?? 0) + usd;
    }

    dailyMap.set(date, entry);
  }

  for (const bucket of costsProject) {
    const date = bucketDateKey(bucket.start_time);
    const entry =
      dailyMap.get(date) ??
      ({
        date,
        amountUsd: 0,
        categories: {},
        projects: {},
      } satisfies OpenAiNormalizedDailyCost);

    for (const result of bucket.results ?? []) {
      const usd = parseAmountUsd(result.amount);
      if (result.project_id) {
        entry.projects[result.project_id] = (entry.projects[result.project_id] ?? 0) + usd;
        projectTotals[result.project_id] = (projectTotals[result.project_id] ?? 0) + usd;
      }
    }

    dailyMap.set(date, entry);
  }

  const usageDays: OpenAiNormalizedUsageDay[] = [];
  for (const bucket of usage) {
    const date = bucketDateKey(bucket.start_time);
    for (const result of bucket.results ?? []) {
      usageDays.push({
        date,
        model: result.model?.trim() || "unknown",
        inputTokens: result.input_tokens ?? 0,
        cachedInputTokens: result.input_cached_tokens ?? 0,
        outputTokens: result.output_tokens ?? 0,
        requests: result.num_model_requests ?? 0,
        projectId: result.project_id ?? null,
      });
    }
  }

  const dailyCosts = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { dailyCosts, usageDays, projectTotals };
}

function sumDailyCosts(dailyCosts: OpenAiNormalizedDailyCost[], from: Date, to: Date): number {
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);
  return dailyCosts
    .filter((d) => d.date >= fromKey && d.date <= toKey)
    .reduce((sum, d) => sum + d.amountUsd, 0);
}

function filterDailyCosts(
  dailyCosts: OpenAiNormalizedDailyCost[],
  from: Date,
  to: Date,
  projectId?: string | null,
): OpenAiNormalizedDailyCost[] {
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);
  return dailyCosts
    .filter((d) => d.date >= fromKey && d.date <= toKey)
    .map((d) => {
      if (!projectId) return d;
      const projectAmount = d.projects[projectId] ?? 0;
      return {
        ...d,
        amountUsd: projectAmount,
        categories: Object.fromEntries(
          Object.entries(d.categories).map(([k, v]) => {
            const ratio = d.amountUsd > 0 ? projectAmount / d.amountUsd : 0;
            return [k, v * ratio];
          }),
        ),
        projects: { [projectId]: projectAmount },
      };
    });
}

async function loadLatestSyncPayload(): Promise<{ syncedAt: Date; payload: OpenAiSyncPayload } | null> {
  const row = await prisma.openAiAdminSyncSnapshot.findFirst({
    where: { errorMessage: null },
    orderBy: { syncedAt: "desc" },
  });
  if (!row) return null;
  return {
    syncedAt: row.syncedAt,
    payload: row.payload as unknown as OpenAiSyncPayload,
  };
}

export async function testOpenAiAdminConnectionSafe(): Promise<{ ok: boolean; message: string }> {
  const apiKey = await resolveOpenAiAdminApiKey();
  if (!apiKey) {
    return { ok: false, message: "Não foi possível conectar à OpenAI." };
  }
  try {
    await testOpenAiAdminConnection(apiKey);
    return { ok: true, message: "Conexão realizada com sucesso." };
  } catch (err) {
    const msg = err instanceof OpenAiAdminApiError ? err.message : "OpenAI connection failed";
    console.warn("[openai-admin] connection test failed:", msg);
    return { ok: false, message: "Não foi possível conectar à OpenAI." };
  }
}

export async function syncOpenAiAdminData(): Promise<{
  syncedAt: string;
  summaryUsd: string;
  error?: string;
}> {
  const apiKey = await resolveOpenAiAdminApiKey();
  if (!apiKey) {
    throw new Error("OpenAI Admin API Key is not configured");
  }

  const now = new Date();
  const periodStart = new Date(now.getTime() - SYNC_LOOKBACK_DAYS * 86_400_000);
  const startTime = Math.floor(periodStart.getTime() / 1000);
  const endTime = Math.floor(now.getTime() / 1000);

  try {
    const costsLineItem = await fetchOpenAiOrganizationCosts(apiKey, startTime, endTime, "line_item");
    const costsProject = await fetchOpenAiOrganizationCosts(apiKey, startTime, endTime, "project_id");
    const usage = await fetchOpenAiCompletionsUsage(apiKey, startTime, endTime);

    const normalized = normalizeOpenAiSyncPayload(costsLineItem, costsProject, usage);
    const payload: OpenAiSyncPayload = { costsLineItem, costsProject, usage, normalized };
    const totalUsd = normalized.dailyCosts.reduce((s, d) => s + d.amountUsd, 0);

    const row = await prisma.openAiAdminSyncSnapshot.create({
      data: {
        periodStart,
        periodEnd: now,
        payload: payload as unknown as Prisma.InputJsonValue,
        summaryUsd: money(totalUsd),
      },
    });

    return {
      syncedAt: row.syncedAt.toISOString(),
      summaryUsd: moneyToApiString(money(totalUsd)),
    };
  } catch (err) {
    const message = err instanceof OpenAiAdminApiError ? err.message : "OpenAI sync failed";
    console.error("[openai-admin] sync failed:", message);
    await prisma.openAiAdminSyncSnapshot.create({
      data: {
        periodStart,
        periodEnd: now,
        payload: { error: true } as Prisma.InputJsonValue,
        summaryUsd: money(0),
        errorMessage: message.slice(0, 2000),
      },
    });
    throw new Error("Não foi possível atualizar os dados da OpenAI.");
  }
}

export type OpenAiDashboardQuery = {
  chartRange?: "7d" | "30d" | "month" | "custom";
  chartFrom?: string;
  chartTo?: string;
  projectId?: string | null;
};

export async function getOpenAiAdminDashboard(query: OpenAiDashboardQuery = {}) {
  const [latest, adminSettings, recharges] = await Promise.all([
    loadLatestSyncPayload(),
    getOpenAiAdminSettingsFromDb(),
    prisma.openAiAdminRecharge.findMany({
      where: { status: "active" },
      orderBy: { rechargedAt: "desc" },
    }),
  ]);

  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const monthStart = startOfUtcMonth(now);
  const last30Start = new Date(todayStart.getTime() - 29 * 86_400_000);

  const dailyCosts = latest?.payload.normalized.dailyCosts ?? [];
  const projectId = query.projectId?.trim() || null;

  const costTodayUsd = sumDailyCosts(filterDailyCosts(dailyCosts, todayStart, now, projectId), todayStart, now);
  const costMonthUsd = sumDailyCosts(filterDailyCosts(dailyCosts, monthStart, now, projectId), monthStart, now);
  const costLast30Usd = sumDailyCosts(filterDailyCosts(dailyCosts, last30Start, now, projectId), last30Start, now);

  const chartRange = query.chartRange ?? "30d";
  let chartFrom = last30Start;
  let chartTo = now;
  if (chartRange === "7d") {
    chartFrom = new Date(todayStart.getTime() - 6 * 86_400_000);
  } else if (chartRange === "month") {
    chartFrom = monthStart;
  } else if (chartRange === "custom" && query.chartFrom && query.chartTo) {
    chartFrom = startOfUtcDay(new Date(query.chartFrom));
    chartTo = startOfUtcDay(new Date(query.chartTo));
  }

  const chartDaily = filterDailyCosts(dailyCosts, chartFrom, chartTo, projectId).map((d) => ({
    date: d.date,
    amountUsd: d.amountUsd,
  }));

  const detailRows = filterDailyCosts(dailyCosts, chartFrom, chartTo, projectId)
    .flatMap((d) =>
      Object.entries(d.categories).map(([category, amountUsd]) => ({
        date: d.date,
        category,
        projectId: projectId ?? null,
        amountUsd,
      })),
    )
    .filter((r) => r.amountUsd > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.amountUsd - a.amountUsd);

  const projectTotals = latest?.payload.normalized.projectTotals ?? {};
  const projects = Object.entries(projectTotals)
    .map(([id, amountUsd]) => ({ id, amountUsd }))
    .sort((a, b) => b.amountUsd - a.amountUsd);

  const totalOfficialCostsUsd = dailyCosts.reduce((s, d) => s + d.amountUsd, 0);
  const totalRechargesUsd = recharges.reduce((s, r) => s + Number(r.amountUsd), 0);
  const initialBalanceUsd = adminSettings?.initialBalanceUsd ?? null;
  const estimatedBalanceUsd =
    initialBalanceUsd != null || totalRechargesUsd > 0
      ? (initialBalanceUsd ?? 0) + totalRechargesUsd - totalOfficialCostsUsd
      : null;

  const usageRows = (latest?.payload.normalized.usageDays ?? []).slice(0, 200);

  const lastError = await prisma.openAiAdminSyncSnapshot.findFirst({
    where: { errorMessage: { not: null } },
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true, errorMessage: true },
  });

  return {
    source: "openai" as const,
    syncedAt: latest?.syncedAt.toISOString() ?? null,
    stale: !latest,
    syncError: lastError?.errorMessage ?? null,
    lastFailedSyncAt: lastError?.syncedAt.toISOString() ?? null,
    costs: {
      todayUsd: costTodayUsd,
      monthUsd: costMonthUsd,
      last30DaysUsd: costLast30Usd,
    },
    estimatedBalanceUsd,
    hasOfficialBalanceApi: false,
    chart: {
      range: chartRange,
      from: chartFrom.toISOString(),
      to: chartTo.toISOString(),
      daily: chartDaily,
    },
    detail: detailRows,
    projects,
    usage: usageRows,
    recharges: recharges.map((r) => ({
      id: r.id,
      amountUsd: moneyToApiString(money(r.amountUsd)),
      rechargedAt: r.rechargedAt.toISOString(),
      note: r.note,
      status: r.status,
    })),
    settings: {
      initialBalanceUsd: adminSettings?.initialBalanceUsd != null ? adminSettings.initialBalanceUsd.toFixed(2) : null,
    },
  };
}

export async function registerOpenAiAdminRecharge(input: {
  amountUsd: number;
  rechargedAt: Date;
  note?: string | null;
  createdByUserId?: string;
}) {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    throw new Error("Invalid recharge amount");
  }
  return prisma.openAiAdminRecharge.create({
    data: {
      amountUsd: money(input.amountUsd),
      rechargedAt: input.rechargedAt,
      note: input.note?.trim().slice(0, 2000) || null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export async function cancelOpenAiAdminRecharge(rechargeId: string) {
  const row = await prisma.openAiAdminRecharge.findUnique({ where: { id: rechargeId } });
  if (!row || row.status !== "active") {
    throw new Error("Recharge not found");
  }
  return prisma.openAiAdminRecharge.update({
    where: { id: rechargeId },
    data: { status: "cancelled" },
  });
}
