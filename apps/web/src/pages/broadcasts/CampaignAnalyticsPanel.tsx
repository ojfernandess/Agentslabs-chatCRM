import { useI18n } from "@/i18n/I18nProvider";
import { CampaignAnalyticsCharts } from "@/pages/broadcasts/analytics/CampaignAnalyticsCharts";
import { CampaignAnalyticsErrorsPanel } from "@/pages/broadcasts/analytics/CampaignAnalyticsErrorsPanel";
import { CampaignAnalyticsFiltersBar } from "@/pages/broadcasts/analytics/CampaignAnalyticsFilters";
import { CampaignAnalyticsSendLog } from "@/pages/broadcasts/analytics/CampaignAnalyticsSendLog";
import { CampaignAnalyticsSummary } from "@/pages/broadcasts/analytics/CampaignAnalyticsSummary";
import { openAnalyticsPdfReport } from "@/pages/broadcasts/analytics/exportAnalytics";
import { useCampaignAnalytics } from "@/pages/broadcasts/analytics/useCampaignAnalytics";

export function CampaignAnalyticsPanel() {
  const { t } = useI18n();
  const { filters, patchFilters, data, loading, error, reload, exportCsv, exportBusy } =
    useCampaignAnalytics();

  const handleExportPdf = () => {
    if (!data) return;
    openAnalyticsPdfReport(data, {
      title: t("broadcastPage.tabAnalytics"),
      period: t("broadcastPage.analyticsFiltersTitle"),
      summary: t("broadcastPage.analyticsSummaryTotal"),
      sendLog: t("broadcastPage.analyticsSendLogTitle"),
      errors: t("broadcastPage.analyticsErrorsTitle"),
    });
  };

  return (
    <div className="space-y-6">
      <CampaignAnalyticsFiltersBar
        filters={filters}
        onChange={patchFilters}
        onExportCsv={() => void exportCsv()}
        onExportPdf={handleExportPdf}
        onReload={() => void reload()}
        exportBusy={exportBusy}
        loading={loading}
      />

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-300/80 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-100"
        >
          <p className="font-semibold">{t("broadcastPage.analyticsLoadError")}</p>
          <p className="mt-1 text-xs opacity-90">{error}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-2 text-xs font-bold underline"
          >
            {t("broadcastPage.analyticsRefresh")}
          </button>
        </div>
      ) : null}

      <CampaignAnalyticsSummary summary={data?.summary} loading={loading} />

      <CampaignAnalyticsErrorsPanel
        errorsByCategory={data?.errorsByCategory ?? []}
        errorSpikeAlert={data?.errorSpikeAlert ?? null}
        loading={loading}
      />

      <CampaignAnalyticsCharts
        sendByDay={data?.sendByDay ?? []}
        ratesByDay={data?.ratesByDay ?? []}
        topCampaigns={data?.topCampaigns ?? []}
        loading={loading}
      />

      <CampaignAnalyticsSendLog
        sendLog={data?.sendLog}
        loading={loading}
        page={filters.page}
        pageSize={filters.pageSize}
        onPageChange={(page) => patchFilters({ page })}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
          <p className="text-xs font-bold text-violet-900 dark:text-violet-200">{t("broadcastPage.analyticsAiInsight")}</p>
          <p className="mt-1 text-sm text-violet-800 dark:text-violet-300">{t("broadcastPage.analyticsAiInsightBody")}</p>
          <span className="mt-2 inline-block rounded-full bg-violet-200/80 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-900 dark:bg-violet-900/50 dark:text-violet-100">
            {t("broadcastPage.soon")}
          </span>
        </div>
        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">{t("broadcastPage.analyticsAbTest")}</p>
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">{t("broadcastPage.analyticsAbTestActive")}</p>
        </div>
      </div>
    </div>
  );
}
