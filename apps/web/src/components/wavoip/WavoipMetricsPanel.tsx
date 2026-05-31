import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type MetricsPayload = {
  range: { from: string; to: string };
  summary: {
    totalCalls: number;
    incoming: number;
    outgoing: number;
    ended: number;
    failed: number;
    rejected: number;
    notAnswered: number;
    answerRate: number;
    avgDurationSec: number | null;
    recordedCalls: number;
  };
  byDay: Array<{ date: string; total: number; ended: number; failed: number }>;
  byDevice: Array<{
    deviceId: string;
    deviceName: string;
    total: number;
    ended: number;
    failed: number;
    avgDurationSec: number | null;
  }>;
};

export function WavoipMetricsPanel() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MetricsPayload>("/settings/wavoip/metrics");
      setMetrics(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.metrics.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = metrics?.summary;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-600" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-ink-50">{t("wavoip.metrics.title")}</h3>
            <p className="text-xs text-slate-500 dark:text-ink-400">{t("wavoip.metrics.subtitle")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-ink-700 dark:hover:bg-ink-800"
        >
          {t("wavoip.metrics.refresh")}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {loading && !metrics ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        </div>
      ) : summary ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["totalCalls", summary.totalCalls],
                ["ended", summary.ended],
                ["failed", summary.failed + summary.rejected],
                ["answerRate", `${summary.answerRate}%`],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-ink-800 dark:bg-ink-950/50"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-ink-400">
                  {t(`wavoip.metrics.${key}`)}
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900 dark:text-ink-50">{value}</p>
              </div>
            ))}
          </div>

          {metrics.byDevice.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-ink-700 dark:text-ink-400">
                    <th className="py-2 pr-4 font-semibold">{t("wavoip.metrics.device")}</th>
                    <th className="py-2 pr-4 font-semibold">{t("wavoip.metrics.totalCalls")}</th>
                    <th className="py-2 pr-4 font-semibold">{t("wavoip.metrics.ended")}</th>
                    <th className="py-2 pr-4 font-semibold">{t("wavoip.metrics.failed")}</th>
                    <th className="py-2 font-semibold">{t("wavoip.metrics.avgDuration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byDevice.map((row) => (
                    <tr key={row.deviceId} className="border-b border-slate-100 dark:border-ink-800">
                      <td className="py-2 pr-4 font-medium text-slate-800 dark:text-ink-200">{row.deviceName}</td>
                      <td className="py-2 pr-4">{row.total}</td>
                      <td className="py-2 pr-4">{row.ended}</td>
                      <td className="py-2 pr-4">{row.failed}</td>
                      <td className="py-2">
                        {row.avgDurationSec != null
                          ? t("wavoip.metrics.durationSec").replace("{n}", String(row.avgDurationSec))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
