import clsx from "clsx";
import { Search, Filter } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { OMNICHANNEL_CHANNELS, type CampaignStatusFilter } from "./campaignTypes";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: CampaignStatusFilter;
  onStatusFilterChange: (v: CampaignStatusFilter) => void;
  channelFilter: string;
  onChannelFilterChange: (v: string) => void;
}

const STATUS_OPTIONS: CampaignStatusFilter[] = ["ALL", "DRAFT", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];

export function CampaignFiltersSidebar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  channelFilter,
  onChannelFilterChange,
}: Props) {
  const { t } = useI18n();

  const statusLabel = (s: CampaignStatusFilter) => {
    if (s === "ALL") return t("broadcastPage.filterAll");
    return (
      {
        DRAFT: t("broadcastPage.statusDraft"),
        RUNNING: t("broadcastPage.statusRunning"),
        COMPLETED: t("broadcastPage.statusCompleted"),
        FAILED: t("broadcastPage.statusFailed"),
        CANCELLED: t("broadcastPage.statusCancelled"),
      } as Record<string, string>
    )[s];
  };

  return (
    <aside className="space-y-4 rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
        <Filter className="h-4 w-4" />
        {t("broadcastPage.filtersTitle")}
      </div>

      <div>
        <label className="text-[11px] font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.filterSearch")}</label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("broadcastPage.filterSearchPlaceholder")}
            className="w-full rounded-xl border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-white/10 dark:bg-white/5"
          />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.filterStatus")}</p>
        <div className="mt-2 flex flex-col gap-1">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusFilterChange(s)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100"
                  : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-white/5",
              )}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.filterChannel")}</p>
        <div className="mt-2 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onChannelFilterChange("all")}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-left text-xs font-medium",
              channelFilter === "all"
                ? "bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100"
                : "text-ink-600 hover:bg-ink-50 dark:hover:bg-white/5",
            )}
          >
            {t("broadcastPage.filterAll")}
          </button>
          {OMNICHANNEL_CHANNELS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              disabled={!ch.available && channelFilter !== ch.id}
              onClick={() => ch.available && onChannelFilterChange(ch.id)}
              className={clsx(
                "flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-medium",
                channelFilter === ch.id && ch.available
                  ? "bg-brand-50 text-brand-900 dark:bg-brand-950/40"
                  : "text-ink-600 hover:bg-ink-50 dark:hover:bg-white/5",
                !ch.available && "cursor-not-allowed opacity-50",
              )}
            >
              <span>{t(ch.labelKey)}</span>
              {!ch.available ? (
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase dark:bg-white/10">
                  {t("broadcastPage.soon")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-ink-500 dark:text-ink-400">{t("broadcastPage.filtersSegmentHint")}</p>
    </aside>
  );
}
