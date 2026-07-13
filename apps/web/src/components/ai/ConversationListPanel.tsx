import clsx from "clsx";
import { Loader2, MessageCircle, Search, Sparkles } from "lucide-react";
import { ContactAvatar } from "@/components/ContactAvatar";
import { useI18n } from "@/i18n/I18nProvider";
import {
  formatRelativeTime,
  lastPublicMessage,
  messageCount,
  type AiInsightsConversationRow,
} from "@/lib/conversationInsights";

type Props = {
  rows: AiInsightsConversationRow[];
  loading: boolean;
  selectedId: string;
  search: string;
  onSearchChange: (v: string) => void;
  agentFilter: string;
  onAgentFilterChange: (v: string) => void;
  tagFilter: string;
  onTagFilterChange: (v: string) => void;
  periodFilter: string;
  onPeriodFilterChange: (v: string) => void;
  agents: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  onSelect: (id: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
  analyzeDisabled: boolean;
};

export function ConversationListPanel({
  rows,
  loading,
  selectedId,
  search,
  onSearchChange,
  agentFilter,
  onAgentFilterChange,
  tagFilter,
  onTagFilterChange,
  periodFilter,
  onPeriodFilterChange,
  agents,
  tags,
  onSelect,
  onAnalyze,
  analyzing,
  analyzeDisabled,
}: Props) {
  const { t, locale } = useI18n();

  return (
    <div className="flex h-full flex-col rounded-2xl border border-ink-200/80 bg-white shadow-sm dark:border-ink-700/60 dark:bg-ink-900/50">
      <div className="border-b border-ink-100 p-4 dark:border-ink-800">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.recentConversations")}</h2>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("aiInsightsPage.searchPlaceholder")}
            className="input-field w-full pl-9"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select value={agentFilter} onChange={(e) => onAgentFilterChange(e.target.value)} className="input-field text-xs">
            <option value="">{t("aiInsightsPage.filterAgent")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select value={tagFilter} onChange={(e) => onTagFilterChange(e.target.value)} className="input-field text-xs">
            <option value="">{t("aiInsightsPage.filterTag")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <select value={periodFilter} onChange={(e) => onPeriodFilterChange(e.target.value)} className="input-field text-xs">
            <option value="7">{t("aiInsightsPage.filterPeriod7")}</option>
            <option value="30">{t("aiInsightsPage.filterPeriod30")}</option>
            <option value="all">{t("aiInsightsPage.filterPeriodAll")}</option>
          </select>
        </div>
        <button
          type="button"
          disabled={analyzeDisabled || analyzing || !selectedId}
          onClick={onAnalyze}
          className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold shadow-md shadow-brand-500/20"
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analyzing ? t("aiInsightsPage.analyzing") : t("aiInsightsPage.analyzeWithAi")}
        </button>
      </div>

      <div className="min-h-[320px] flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="p-6 text-center text-sm text-ink-500">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">{t("aiInsightsPage.noConversations")}</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => {
              const selected = row.id === selectedId;
              const count = messageCount(row);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className={clsx(
                      "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                      selected
                        ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/30 dark:ring-brand-800/60"
                        : "hover:bg-ink-50 dark:hover:bg-ink-800/40",
                    )}
                  >
                    <ContactAvatar
                      contactId={row.contact.id}
                      name={row.contact.name}
                      profilePictureUrl={row.contact.profilePictureUrl}
                      hasAvatar={row.contact.hasAvatar}
                      thumbnail={row.contact.thumbnail}
                      variant="listCompact"
                      className="h-11 w-11"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{row.contact.name}</span>
                        <span className="shrink-0 text-[10px] text-ink-500">
                          {formatRelativeTime(row.updatedAt, locale)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-ink-600 dark:text-ink-400">{lastPublicMessage(row)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </span>
                        {count > 0 ? (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                            {count} {t("aiInsightsPage.messages")}
                          </span>
                        ) : null}
                        {row.isUnread ? (
                          <span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden />
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
