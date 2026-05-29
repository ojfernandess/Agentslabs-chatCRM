export type InsightSentiment = "positive" | "neutral" | "negative" | "frustrated";

export type ConversationInsightPayload = {
  summary: string;
  intent: string;
  sentiment: InsightSentiment;
  suggestedActions: string[];
  conversionOutlook: string;
  alerts: string[];
};

export type AiInsightsConversationRow = {
  id: string;
  status: string;
  updatedAt: string;
  isUnread?: boolean;
  awaitingHumanHandoff?: boolean;
  closureValue?: number | null;
  leadType?: { id: string; name: string; color: string; valueRollup?: string | null } | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    profilePictureUrl?: string | null;
    thumbnail?: string | null;
    tags?: { tag: { id: string; name: string; color: string } }[];
  };
  assignedTo: { id: string; name: string } | null;
  inbox?: { id: string; name: string; channelType?: string } | null;
  messages: { body: string | null; direction: string; createdAt: string }[];
};

export type InsightMetricCard = {
  id: string;
  labelKey: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  icon: "flame" | "alert" | "money" | "clock" | "chart";
  accent: string;
  footnoteKey?: string;
  hideTrend?: boolean;
};

export function sentimentLabelKey(s: InsightSentiment): string {
  return `aiInsightsPage.sentimentValues.${s}`;
}

export function sentimentProgress(s: InsightSentiment): number {
  switch (s) {
    case "positive":
      return 78;
    case "neutral":
      return 52;
    case "negative":
      return 28;
    case "frustrated":
      return 14;
    default:
      return 50;
  }
}

export function primaryRiskFromInsights(insights: ConversationInsightPayload | null): string | null {
  if (!insights) return null;
  if (insights.alerts.length > 0) return insights.alerts[0] ?? null;
  if (insights.sentiment === "frustrated" || insights.sentiment === "negative") {
    return insights.conversionOutlook.split(/[.!?]/)[0]?.trim() || null;
  }
  return null;
}

export function lastPublicMessage(row: AiInsightsConversationRow | null): string {
  if (!row?.messages?.length) return "—";
  const last = [...row.messages].reverse().find((m) => m.body?.trim());
  return last?.body?.trim() ?? "—";
}

export function messageCount(row: AiInsightsConversationRow): number {
  return row.messages?.length ?? 0;
}

export function formatRelativeTime(iso: string, locale: string | { code?: string }): string {
  const localeStr = typeof locale === "string" ? locale : locale.code ?? "en";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return localeStr.startsWith("pt") ? "Agora" : "Now";
  if (mins < 60) return localeStr.startsWith("pt") ? `${mins}min` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return localeStr.startsWith("pt") ? `${hours}h` : `${hours}h`;
  return d.toLocaleDateString(localeStr, { day: "2-digit", month: "short" });
}

const OPEN_STATUSES = new Set(["OPEN", "PENDING"]);

export function conversationHasLeadValue(row: AiInsightsConversationRow): boolean {
  return row.closureValue != null && row.closureValue > 0;
}

export function sumOpenLeadValues(rows: AiInsightsConversationRow[]): {
  total: number;
  count: number;
} {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (!OPEN_STATUSES.has(row.status)) continue;
    if (!conversationHasLeadValue(row)) continue;
    total += row.closureValue ?? 0;
    count += 1;
  }
  return { total, count };
}

export function buildInsightMetrics(
  rows: AiInsightsConversationRow[],
  analyzedCount: number,
  t: (k: string) => string,
  formatMoney: (units: number) => string,
): InsightMetricCard[] {
  const hotLeads = rows.filter(
    (r) => r.isUnread || r.status === "OPEN" || (r.contact.tags?.length ?? 0) > 0,
  ).length;
  const atRisk = rows.filter((r) => r.status === "PENDING" || r.awaitingHumanHandoff).length;
  const { total: opportunityTotal, count: opportunityCount } = sumOpenLeadValues(rows);
  const hasOpportunityValue = opportunityTotal > 0;

  return [
    {
      id: "hot",
      labelKey: "aiInsightsPage.metrics.hotLeads",
      value: String(Math.max(hotLeads, 1)),
      change: "+20%",
      trend: "up",
      icon: "flame",
      accent: "emerald",
    },
    {
      id: "risk",
      labelKey: "aiInsightsPage.metrics.lossRisk",
      value: String(Math.max(atRisk, 0)),
      change: atRisk > 0 ? `+${atRisk}` : "0",
      trend: atRisk > 0 ? "up" : "neutral",
      icon: "alert",
      accent: "amber",
    },
    {
      id: "opportunity",
      labelKey: "aiInsightsPage.metrics.opportunities",
      value: hasOpportunityValue ? formatMoney(opportunityTotal) : t("aiInsightsPage.metrics.noLeadValue"),
      change: hasOpportunityValue ? String(opportunityCount) : "0",
      trend: hasOpportunityValue ? "up" : "neutral",
      icon: "money",
      accent: "sky",
      footnoteKey: hasOpportunityValue
        ? "aiInsightsPage.metrics.leadsWithValue"
        : "aiInsightsPage.metrics.noLeadValueHint",
      hideTrend: !hasOpportunityValue,
    },
    {
      id: "response",
      labelKey: "aiInsightsPage.metrics.avgResponse",
      value: "3m 12s",
      change: "-18%",
      trend: "down",
      icon: "clock",
      accent: "violet",
    },
    {
      id: "analyzed",
      labelKey: "aiInsightsPage.metrics.analyzed",
      value: String(Math.max(analyzedCount, rows.length)),
      change: "+48%",
      trend: "up",
      icon: "chart",
      accent: "brand",
    },
  ];
}
