import { useI18n } from "@/i18n/I18nProvider";
import type { BroadcastCampaignAnalytics } from "./types";

interface Props {
  summary: BroadcastCampaignAnalytics["summary"] | undefined;
  loading?: boolean;
}

export function CampaignAnalyticsSummary({ summary, loading }: Props) {
  const { t } = useI18n();
  const fmtPct = (v: number | null | undefined) =>
    v == null ? t("broadcastPage.metricUnavailable") : `${v}%`;
  const fmt = (n: number | undefined) => (loading ? "—" : (n ?? 0).toLocaleString());

  const cards = [
    { label: t("broadcastPage.analyticsSummaryTotal"), value: fmt(summary?.total) },
    { label: t("broadcastPage.analyticsSent"), value: fmt(summary?.sent) },
    { label: t("broadcastPage.analyticsFailed"), value: fmt(summary?.failed) },
    { label: t("broadcastPage.metricDeliveryRate"), value: fmtPct(summary?.deliveryRate) },
    { label: t("broadcastPage.analyticsErrorRate"), value: fmtPct(summary?.errorRate) },
    { label: t("broadcastPage.analyticsEngagementRate"), value: fmtPct(summary?.engagementRate) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-ink-200/80 bg-white/90 px-3 py-3 dark:border-white/10 dark:bg-[#111C2B]/55"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{c.label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
