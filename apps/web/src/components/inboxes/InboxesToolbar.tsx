import clsx from "clsx";
import { LayoutGrid, List, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { INBOX_CHANNEL_ORDER } from "@/lib/inboxChannelUi";

export type InboxViewMode = "list" | "grid";
export type InboxChannelFilter = "ALL" | (typeof INBOX_CHANNEL_ORDER)[number];
export type InboxStatusFilter = "ALL" | "READY" | "SETUP";

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
  channelFilter: InboxChannelFilter;
  onChannelFilterChange: (v: InboxChannelFilter) => void;
  statusFilter: InboxStatusFilter;
  onStatusFilterChange: (v: InboxStatusFilter) => void;
  viewMode: InboxViewMode;
  onViewModeChange: (v: InboxViewMode) => void;
  channelLabel: (ct: string) => string;
};

export function InboxesToolbar({
  search,
  onSearchChange,
  channelFilter,
  onChannelFilterChange,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
  channelLabel,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ink-200/80 bg-white p-3 shadow-sm dark:border-ink-700/80 dark:bg-ink-950/50 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("inboxesPage.dashboard.searchPlaceholder")}
          className="w-full rounded-xl border border-ink-200 bg-ink-50/80 py-2.5 pl-10 pr-3 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-500/20 dark:border-ink-600 dark:bg-ink-900/60 dark:text-ink-50 dark:focus:border-brand-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={channelFilter}
          onChange={(e) => onChannelFilterChange(e.target.value as InboxChannelFilter)}
          className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
        >
          <option value="ALL">{t("inboxesPage.dashboard.filterAllChannels")}</option>
          {INBOX_CHANNEL_ORDER.map((ch) => (
            <option key={ch} value={ch}>
              {channelLabel(ch)}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as InboxStatusFilter)}
          className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
        >
          <option value="ALL">{t("inboxesPage.dashboard.filterAllStatus")}</option>
          <option value="READY">{t("inboxesPage.dashboard.filterReady")}</option>
          <option value="SETUP">{t("inboxesPage.dashboard.filterNeedsSetup")}</option>
        </select>

        <div className="flex rounded-xl border border-ink-200 p-0.5 dark:border-ink-600">
          <button
            type="button"
            onClick={() => onViewModeChange("list")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              viewMode === "list"
                ? "bg-brand-600 text-white shadow-sm"
                : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
            )}
          >
            <List className="h-3.5 w-3.5" />
            {t("inboxesPage.dashboard.viewList")}
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("grid")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              viewMode === "grid"
                ? "bg-brand-600 text-white shadow-sm"
                : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {t("inboxesPage.dashboard.viewGrid")}
          </button>
        </div>
      </div>
    </div>
  );
}
