import { Download, FileText, RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { OMNICHANNEL_CHANNELS } from "../campaignTypes";
import type { CampaignAnalyticsFilters } from "./types";

interface Props {
  filters: CampaignAnalyticsFilters;
  onChange: (patch: Partial<CampaignAnalyticsFilters>) => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
  onReload: () => void;
  exportBusy?: boolean;
  loading?: boolean;
}

export function CampaignAnalyticsFiltersBar({
  filters,
  onChange,
  onExportCsv,
  onExportPdf,
  onReload,
  exportBusy,
  loading,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsFiltersTitle")}</h3>
          <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.analyticsFiltersSub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/5"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {t("broadcastPage.analyticsRefresh")}
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            disabled={exportBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-50 dark:border-brand-800/40 dark:bg-brand-500/10 dark:text-brand-200"
          >
            <Download className="h-3.5 w-3.5" />
            {t("broadcastPage.analyticsExportCsv")}
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 dark:border-white/10 dark:text-ink-200"
          >
            <FileText className="h-3.5 w-3.5" />
            {t("broadcastPage.analyticsExportPdf")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="block text-xs">
          <span className="font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.analyticsDateFrom")}</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ from: e.target.value, page: 1 })}
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-[#0d1520]"
          />
        </label>
        <label className="block text-xs">
          <span className="font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.analyticsDateTo")}</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ to: e.target.value, page: 1 })}
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-[#0d1520]"
          />
        </label>
        <label className="block text-xs">
          <span className="font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.analyticsCampaignKind")}</span>
          <select
            value={filters.campaignKind}
            onChange={(e) =>
              onChange({ campaignKind: e.target.value as CampaignAnalyticsFilters["campaignKind"], page: 1 })
            }
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-[#0d1520]"
          >
            <option value="all">{t("broadcastPage.filterAll")}</option>
            <option value="followup">{t("broadcastPage.kindFollowUp")}</option>
            <option value="broadcast">{t("broadcastPage.kindBroadcast")}</option>
            <option value="ai">{t("broadcastPage.kindAi")}</option>
            <option value="flow">{t("broadcastPage.kindFlow")}</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.analyticsSendStatus")}</span>
          <select
            value={filters.status}
            onChange={(e) =>
              onChange({ status: e.target.value as CampaignAnalyticsFilters["status"], page: 1 })
            }
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-[#0d1520]"
          >
            <option value="ALL">{t("broadcastPage.filterAll")}</option>
            <option value="SENT">{t("broadcastPage.analyticsStatusSent")}</option>
            <option value="FAILED">{t("broadcastPage.analyticsStatusFailed")}</option>
            <option value="PENDING">{t("broadcastPage.analyticsStatusPending")}</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.filterChannel")}</span>
          <select
            value={filters.channel}
            onChange={(e) => onChange({ channel: e.target.value, page: 1 })}
            className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-[#0d1520]"
          >
            <option value="">{t("broadcastPage.filterAll")}</option>
            {OMNICHANNEL_CHANNELS.filter((c) => c.available).map((c) => {
              const apiChannel = c.id === "messenger" ? "MESSENGER" : c.id.toUpperCase();
              return (
                <option key={c.id} value={apiChannel}>
                  {t(c.labelKey)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="block text-xs sm:col-span-2 lg:col-span-1 xl:col-span-1">
          <span className="font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.analyticsSearch")}</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={filters.search}
              onChange={(e) => onChange({ search: e.target.value, page: 1 })}
              placeholder={t("broadcastPage.analyticsSearchPlaceholder")}
              className="w-full rounded-lg border border-ink-200 bg-white py-1.5 pl-8 pr-2 text-sm dark:border-white/10 dark:bg-[#0d1520]"
            />
          </div>
        </label>
      </div>
    </div>
  );
}
