import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";
import type { BroadcastDashboard } from "./campaignTypes";

interface Props {
  dashboard: BroadcastDashboard | null;
  loading?: boolean;
}

export function CampaignAnalyticsPanel({ dashboard, loading }: Props) {
  const { t } = useI18n();
  const chartData = dashboard?.sendByDay ?? [];
  const top = dashboard?.topCampaigns ?? [];

  if (loading) {
    return <p className="text-sm text-ink-500">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsVolume")}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.analyticsVolumeSub")}</p>
        <div className="mt-4 h-64">
          {chartData.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-ink-500">{t("broadcastPage.analyticsEmpty")}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="sent" name={t("broadcastPage.analyticsSent")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="failed" name={t("broadcastPage.analyticsFailed")} fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsTop")}</h3>
        {top.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">{t("broadcastPage.analyticsEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 dark:divide-white/10">
            {top.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="truncate font-medium text-ink-800 dark:text-ink-100">{c.name}</span>
                <span className="shrink-0 tabular-nums text-ink-600 dark:text-ink-300">
                  {c.sentCount} {t("broadcastPage.analyticsSent").toLowerCase()}
                  {c.deliveryRate != null ? ` · ${c.deliveryRate}%` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
          <p className="text-xs font-bold text-violet-900 dark:text-violet-200">{t("broadcastPage.analyticsAiInsight")}</p>
          <p className="mt-1 text-sm text-violet-800 dark:text-violet-300">{t("broadcastPage.analyticsAiInsightBody")}</p>
          <span className="mt-2 inline-block rounded-full bg-violet-200/80 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-900 dark:bg-violet-900/50 dark:text-violet-100">
            {t("broadcastPage.soon")}
          </span>
        </div>
        <div className="rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-xs font-bold text-ink-800 dark:text-ink-200">{t("broadcastPage.analyticsAbTest")}</p>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("broadcastPage.analyticsAbTestBody")}</p>
          <span className="mt-2 inline-block rounded-full bg-ink-200/80 px-2 py-0.5 text-[10px] font-bold uppercase dark:bg-white/10">
            {t("broadcastPage.soon")}
          </span>
        </div>
      </div>
    </div>
  );
}
