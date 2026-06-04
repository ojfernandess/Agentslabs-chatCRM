import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";
import type { BroadcastCampaignAnalytics } from "./types";

interface Props {
  sendByDay: BroadcastCampaignAnalytics["sendByDay"];
  ratesByDay: BroadcastCampaignAnalytics["ratesByDay"];
  topCampaigns: BroadcastCampaignAnalytics["topCampaigns"];
  loading?: boolean;
}

export function CampaignAnalyticsCharts({ sendByDay, ratesByDay, topCampaigns, loading }: Props) {
  const { t } = useI18n();

  if (loading) {
    return <p className="text-sm text-ink-500">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsVolume")}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.analyticsVolumeSub")}</p>
        <div className="mt-4 h-64">
          {sendByDay.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-ink-500">
              {t("broadcastPage.analyticsEmpty")}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sendByDay}>
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
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsRatesChart")}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.analyticsRatesChartSub")}</p>
        <div className="mt-4 h-64">
          {ratesByDay.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-ink-500">
              {t("broadcastPage.analyticsEmpty")}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ratesByDay}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="deliveryRate"
                  name={t("broadcastPage.metricDeliveryRate")}
                  stroke="#22c55e"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="errorRate"
                  name={t("broadcastPage.analyticsErrorRate")}
                  stroke="#ef4444"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="engagementRate"
                  name={t("broadcastPage.analyticsEngagementRate")}
                  stroke="#8b5cf6"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsTop")}</h3>
        {topCampaigns.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">{t("broadcastPage.analyticsEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 dark:divide-white/10">
            {topCampaigns.map((c) => (
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
    </div>
  );
}
