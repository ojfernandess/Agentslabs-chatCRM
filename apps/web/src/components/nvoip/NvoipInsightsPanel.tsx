import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type InsightsPayload = {
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
  rates: { label: string; value: string; unit: string | null }[];
  estimatedCostBrl: number | null;
  ratePerMinuteUsed: number | null;
};

type UraPayload = {
  summary: {
    audios: number;
    menus: number;
    schedules: number;
    queues: number;
    users: number;
  };
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function NvoipInsightsPanel({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [ura, setUra] = useState<UraPayload["summary"] | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingUra, setLoadingUra] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setLoadingInsights(true);
    setError(null);
    try {
      const data = await api.get<InsightsPayload>("/settings/nvoip/insights?days=30");
      setInsights(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.insights.loadError"));
    } finally {
      setLoadingInsights(false);
    }
  }, [t]);

  const loadUra = useCallback(async () => {
    setLoadingUra(true);
    setError(null);
    try {
      const data = await api.get<UraPayload>("/settings/nvoip/ura");
      setUra(data.summary);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.ura.loadError"));
    } finally {
      setLoadingUra(false);
    }
  }, [t]);

  useEffect(() => {
    if (connected) void loadInsights();
  }, [connected, loadInsights]);

  if (!connected) return null;

  const c = insights?.calls;

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-ink-50">
                {t("nvoip.insights.title")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-ink-400">{t("nvoip.insights.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadInsights()}
            disabled={loadingInsights}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-ink-700 dark:hover:bg-ink-800"
          >
            {t("nvoip.insights.refresh")}
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {loadingInsights && !insights ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          </div>
        ) : insights && c ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["totalCalls", c.total],
                  ["inbound", c.inbound],
                  ["outbound", c.outbound],
                  ["duration", formatDuration(c.totalDurationSec)],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-ink-800 dark:bg-ink-950/50"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ink-400">
                    {t(`nvoip.insights.${key}`)}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-ink-50">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600 dark:text-ink-300">
              {insights.balance ? (
                <span>
                  {t("nvoip.balance")}: <strong>{insights.balance}</strong>
                </span>
              ) : null}
              {insights.estimatedCostBrl != null ? (
                <span>
                  {t("nvoip.insights.estimatedCost").replace(
                    "{amount}",
                    insights.estimatedCostBrl.toFixed(2),
                  )}
                </span>
              ) : (
                <span className="text-slate-400">{t("nvoip.insights.noCostEstimate")}</span>
              )}
              <span>
                {t("nvoip.insights.torpedo")}: {insights.torpedoDispatches}
              </span>
              <span>
                {t("nvoip.insights.smsEvents")}: {insights.integrationEvents.sms}
              </span>
            </div>
            {insights.rates.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                  {t("nvoip.insights.ratesTitle")}
                </p>
                <table className="w-full min-w-[320px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-4">{t("nvoip.insights.rateLabel")}</th>
                      <th className="py-2 pr-4">{t("nvoip.insights.rateValue")}</th>
                      <th className="py-2">{t("nvoip.insights.rateUnit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.rates.map((r, i) => (
                      <tr key={`${r.label}-${i}`} className="border-b border-slate-100 dark:border-ink-800">
                        <td className="py-2 pr-4">{r.label}</td>
                        <td className="py-2 pr-4 font-mono">{r.value}</td>
                        <td className="py-2">{r.unit ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("nvoip.ura.title")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("nvoip.ura.hint")}</p>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loadingUra}
            onClick={() => void loadUra()}
          >
            {loadingUra ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.ura.load")}
          </button>
        </div>
        {ura ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {(
              [
                ["menus", ura.menus],
                ["queues", ura.queues],
                ["schedules", ura.schedules],
                ["audios", ura.audios],
                ["users", ura.users],
              ] as const
            ).map(([key, count]) => (
              <div key={key} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-ink-950">
                <dt className="text-xs text-slate-500">{t(`nvoip.ura.${key}`)}</dt>
                <dd className="text-lg font-semibold text-slate-900 dark:text-ink-50">{count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">{t("nvoip.ura.empty")}</p>
        )}
      </div>
    </div>
  );
}
