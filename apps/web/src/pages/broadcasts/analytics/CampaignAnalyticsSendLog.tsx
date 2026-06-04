import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { CHANNEL_LABEL_KEYS } from "../campaignTypes";
import type { BroadcastCampaignAnalytics } from "./types";

interface Props {
  sendLog: BroadcastCampaignAnalytics["sendLog"] | undefined;
  loading?: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale);
  } catch {
    return iso;
  }
}

export function CampaignAnalyticsSendLog({ sendLog, loading, page, pageSize, onPageChange }: Props) {
  const { t, locale } = useI18n();
  const total = sendLog?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-white/10 dark:bg-[#111C2B]/55">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.analyticsSendLogTitle")}</h3>
          <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.analyticsSendLogSub")}</p>
        </div>
        <p className="text-xs tabular-nums text-ink-500">
          {t("broadcastPage.analyticsSendLogCount").replace("{total}", total.toLocaleString())}
        </p>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-ink-500">{t("common.loading")}</p>
      ) : !sendLog?.items.length ? (
        <p className="mt-4 text-sm text-ink-500">{t("broadcastPage.analyticsEmpty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-ink-200 text-[10px] font-bold uppercase tracking-wide text-ink-500 dark:border-white/10">
                <th className="px-2 py-2">{t("broadcastPage.analyticsColSentAt")}</th>
                <th className="px-2 py-2">{t("broadcastPage.analyticsColContact")}</th>
                <th className="px-2 py-2">{t("broadcastPage.filterChannel")}</th>
                <th className="px-2 py-2">{t("broadcastPage.colStatus")}</th>
                <th className="px-2 py-2">{t("broadcastPage.analyticsColCampaign")}</th>
              </tr>
            </thead>
            <tbody>
              {sendLog.items.map((row) => {
                const channelKey = CHANNEL_LABEL_KEYS[row.channel];
                const contact = row.phone ?? row.email ?? row.contactName ?? "—";
                return (
                  <tr key={row.id} className="border-b border-ink-100 dark:border-white/5">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-ink-700 dark:text-ink-200">
                      {formatDateTime(row.sentAt ?? row.createdAt, locale)}
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-2 font-mono text-[11px]">{contact}</td>
                    <td className="px-2 py-2">{channelKey ? t(channelKey) : row.channel}</td>
                    <td className="px-2 py-2">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                          row.status === "SENT" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                          row.status === "FAILED" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
                          row.status === "PENDING" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
                        )}
                      >
                        {row.status}
                      </span>
                      {row.error ? (
                        <p className="mt-0.5 max-w-xs truncate text-[10px] text-rose-600 dark:text-rose-300" title={row.error}>
                          {row.error}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2">{row.campaignName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-xs font-semibold disabled:opacity-40 dark:border-white/10"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("broadcastPage.analyticsPrevPage")}
          </button>
          <span className="text-xs tabular-nums text-ink-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-xs font-semibold disabled:opacity-40 dark:border-white/10"
          >
            {t("broadcastPage.analyticsNextPage")}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
