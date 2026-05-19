import clsx from "clsx";
import {
  Send,
  CheckCircle2,
  MessageCircle,
  TrendingUp,
  Users,
  Radio,
  AlertTriangle,
  DollarSign,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { BroadcastDashboard } from "./campaignTypes";

interface Props {
  dashboard: BroadcastDashboard | null;
  loading?: boolean;
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "brand",
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Send;
  tone?: "brand" | "emerald" | "amber" | "rose" | "violet";
  loading?: boolean;
}) {
  const tones = {
    brand: "text-brand-600 bg-brand-50 dark:text-brand-300 dark:bg-brand-500/10",
    emerald: "text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10",
    amber: "text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10",
    rose: "text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/10",
    violet: "text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-500/10",
  };
  return (
    <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[#111C2B]/55">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</p>
          <p
            className={clsx(
              "mt-1 text-2xl font-bold tabular-nums text-ink-900 dark:text-ink-50",
              loading && "animate-pulse text-ink-300 dark:text-ink-600",
            )}
          >
            {value}
          </p>
          {sub ? <p className="mt-0.5 text-[10px] text-ink-500 dark:text-ink-400">{sub}</p> : null}
        </div>
        <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

export function CampaignCenterMetrics({ dashboard, loading }: Props) {
  const { t } = useI18n();
  const m = dashboard?.metrics;

  const fmtPct = (v: number | null | undefined) =>
    v == null ? t("broadcastPage.metricUnavailable") : `${v}%`;
  const fmtNum = (v: number | undefined) => (loading ? "—" : (v ?? 0).toLocaleString());

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <MetricCard
        label={t("broadcastPage.metricSentToday")}
        value={fmtNum(m?.sentToday)}
        icon={Send}
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricDeliveryRate")}
        value={fmtPct(m?.deliveryRate)}
        sub={t("broadcastPage.metricDeliverySub")}
        icon={CheckCircle2}
        tone="emerald"
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricResponseRate")}
        value={fmtPct(m?.responseRate)}
        sub={t("broadcastPage.metricResponseSub")}
        icon={MessageCircle}
        tone="violet"
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricConversions")}
        value={fmtPct(m?.conversions)}
        sub={t("broadcastPage.metricConversionsSub")}
        icon={TrendingUp}
        tone="emerald"
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricLeads")}
        value={fmtNum(m?.leadsGenerated)}
        sub={t("broadcastPage.metricLeadsSub")}
        icon={Users}
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricActive")}
        value={fmtNum(m?.activeCampaigns)}
        icon={Radio}
        tone="amber"
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricFailed")}
        value={fmtNum(m?.failedMessages)}
        sub={t("broadcastPage.metricFailedSub")}
        icon={AlertTriangle}
        tone="rose"
        loading={loading}
      />
      <MetricCard
        label={t("broadcastPage.metricRoi")}
        value={m?.roi != null ? `R$ ${m.roi.toLocaleString()}` : t("broadcastPage.metricUnavailable")}
        sub={t("broadcastPage.metricRoiSub")}
        icon={DollarSign}
        tone="violet"
        loading={loading}
      />
    </div>
  );
}
