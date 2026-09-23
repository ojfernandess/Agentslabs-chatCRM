import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import clsx from "clsx";
import { format, type Locale } from "date-fns";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export type ConversationMessageSearchResult = {
  message: {
    id: string;
    direction: string;
    type: string;
    body: string | null;
    createdAt: string;
    isPrivate?: boolean;
  };
  snippet: string;
  cursor: string;
};

type SearchResponse = {
  results: ConversationMessageSearchResult[];
  total: number;
  nextCursor: string | null;
};

type ConversationMessageSearchPanelProps = {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  onJumpToResult: (
    result: ConversationMessageSearchResult,
    index: number,
    total: number,
    query: string,
  ) => void;
  dateLocale: Locale;
};

const MESSAGE_TYPES = ["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "TEMPLATE"] as const;
const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;

export function ConversationMessageSearchPanel({
  conversationId,
  open,
  onClose,
  onJumpToResult,
  dateLocale,
}: ConversationMessageSearchPanelProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<ConversationMessageSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchGenRef = useRef(0);

  const hasFilters = Boolean(typeFilter || directionFilter || fromDate || toDate);
  const canSearch = query.trim().length >= 2 || hasFilters;

  const buildParams = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams();
      const q = query.trim();
      if (q) params.set("q", q);
      if (typeFilter) params.set("type", typeFilter);
      if (directionFilter) params.set("direction", directionFilter);
      if (fromDate) params.set("from", new Date(`${fromDate}T00:00:00`).toISOString());
      if (toDate) params.set("to", new Date(`${toDate}T23:59:59.999`).toISOString());
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [query, typeFilter, directionFilter, fromDate, toDate],
  );

  const runSearch = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      if (!conversationId || !canSearch) return;
      const gen = ++searchGenRef.current;
      if (opts?.append) setLoadingMore(true);
      else {
        setLoading(true);
        setError("");
      }

      try {
        const res = await api.get<SearchResponse>(
          `/conversations/${conversationId}/messages/search?${buildParams(opts?.cursor ?? null)}`,
        );
        if (gen !== searchGenRef.current) return;
        setTotal(res.total ?? 0);
        setNextCursor(res.nextCursor ?? null);
        setResults((prev) => (opts?.append ? [...prev, ...res.results] : res.results));
        if (!opts?.append) setActiveIndex(res.results.length > 0 ? 0 : -1);
      } catch {
        if (gen !== searchGenRef.current) return;
        if (!opts?.append) {
          setResults([]);
          setTotal(0);
          setNextCursor(null);
          setActiveIndex(-1);
          setError(t("conversationDetail.messageSearch.error"));
        }
      } finally {
        if (gen === searchGenRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildParams, canSearch, conversationId, t],
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!canSearch) {
      setResults([]);
      setTotal(0);
      setNextCursor(null);
      setActiveIndex(-1);
      setError("");
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, canSearch, runSearch]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setTypeFilter("");
      setDirectionFilter("");
      setFromDate("");
      setToDate("");
      setShowFilters(false);
      setResults([]);
      setTotal(0);
      setNextCursor(null);
      setActiveIndex(-1);
      setError("");
    }
  }, [conversationId, open]);

  const jumpToIndex = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      setActiveIndex(index);
      onJumpToResult(result, index, total, query.trim());
    },
    [onJumpToResult, results, total],
  );

  if (!open) return null;

  return (
    <div className="border-b border-ink-200/80 bg-white/95 px-3 py-3 backdrop-blur-sm dark:border-soft-border dark:bg-[#151826]/90 lg:px-5">
      <div className="flex items-start gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("conversationDetail.messageSearch.placeholder")}
            className="input-field h-10 pl-10 pr-10 text-sm"
            aria-label={t("conversationDetail.messageSearch.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key === "Enter" && results.length > 0) {
                e.preventDefault();
                jumpToIndex(activeIndex >= 0 ? activeIndex : 0);
              }
              if (e.key === "ArrowDown" && results.length > 0) {
                e.preventDefault();
                setActiveIndex((prev) => Math.min(results.length - 1, prev < 0 ? 0 : prev + 1));
              }
              if (e.key === "ArrowUp" && results.length > 0) {
                e.preventDefault();
                setActiveIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1));
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/10"
              onClick={() => setQuery("")}
              aria-label={t("conversationDetail.messageSearch.clearQuery")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={clsx(
            "inline-flex h-10 items-center gap-1 rounded-xl border px-3 text-xs font-medium",
            showFilters
              ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200"
              : "border-ink-200 bg-white text-ink-700 dark:border-soft-border dark:bg-ink-900 dark:text-ink-200",
          )}
          onClick={() => setShowFilters((v) => !v)}
        >
          {t("conversationDetail.messageSearch.filters")}
          <ChevronDown className={clsx("h-3.5 w-3.5 transition", showFilters && "rotate-180")} />
        </button>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-soft-border dark:bg-ink-900 dark:text-ink-200"
          onClick={onClose}
          aria-label={t("conversationDetail.messageSearch.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {showFilters ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs text-ink-600 dark:text-ink-300">
            {t("conversationDetail.messageSearch.filterType")}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input-field h-9 text-xs"
            >
              <option value="">{t("conversationDetail.messageSearch.allTypes")}</option>
              {MESSAGE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-600 dark:text-ink-300">
            {t("conversationDetail.messageSearch.filterDirection")}
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="input-field h-9 text-xs"
            >
              <option value="">{t("conversationDetail.messageSearch.allDirections")}</option>
              {MESSAGE_DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction === "INBOUND"
                    ? t("conversationDetail.messageSearch.directionInbound")
                    : t("conversationDetail.messageSearch.directionOutbound")}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-600 dark:text-ink-300">
            {t("conversationDetail.messageSearch.filterFrom")}
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="input-field h-9 text-xs"
            />
          </label>
          <label className="grid gap-1 text-xs text-ink-600 dark:text-ink-300">
            {t("conversationDetail.messageSearch.filterTo")}
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="input-field h-9 text-xs"
            />
          </label>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500 dark:text-ink-400">
        <span>
          {!canSearch
            ? t("conversationDetail.messageSearch.minChars")
            : loading
              ? t("conversationDetail.messageSearch.searching")
              : total > 0
                ? t("conversationDetail.messageSearch.resultsCount").replace("{count}", String(total))
                : t("conversationDetail.messageSearch.noResults")}
        </span>
        {results.length > 0 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white hover:bg-ink-50 disabled:opacity-40 dark:border-soft-border dark:bg-ink-900"
              disabled={activeIndex <= 0}
              onClick={() => jumpToIndex(Math.max(0, activeIndex - 1))}
              aria-label={t("conversationDetail.messageSearch.previous")}
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <span className="min-w-[4.5rem] text-center tabular-nums">
              {activeIndex >= 0
                ? t("conversationDetail.messageSearch.position")
                    .replace("{current}", String(activeIndex + 1))
                    .replace("{total}", String(total))
                : "—"}
            </span>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white hover:bg-ink-50 disabled:opacity-40 dark:border-soft-border dark:bg-ink-900"
              disabled={activeIndex < 0 || activeIndex >= results.length - 1}
              onClick={() => jumpToIndex(Math.min(results.length - 1, activeIndex + 1))}
              aria-label={t("conversationDetail.messageSearch.next")}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      {results.length > 0 ? (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-ink-200/80 pr-1 dark:border-soft-border xl:pr-12">
          {results.map((result, index) => (
            <button
              key={result.message.id}
              type="button"
              onClick={() => jumpToIndex(index)}
              className={clsx(
                "flex w-full flex-col gap-1 border-b border-ink-100 px-3 py-2 text-left last:border-b-0 dark:border-soft-border/60",
                index === activeIndex
                  ? "bg-brand-50/90 dark:bg-brand-500/10"
                  : "hover:bg-ink-50 dark:hover:bg-white/5",
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-500 dark:text-ink-400">
                <span className="font-medium uppercase tracking-wide">
                  {result.message.direction === "INBOUND"
                    ? t("conversationDetail.messageSearch.directionInbound")
                    : t("conversationDetail.messageSearch.directionOutbound")}
                  {result.message.isPrivate ? ` · ${t("conversationDetail.internalNoteLabel")}` : ""}
                </span>
                <span>{format(new Date(result.message.createdAt), "PPp", { locale: dateLocale })}</span>
              </div>
              <span className="line-clamp-2 text-sm text-ink-800 dark:text-ink-100">
                {result.snippet || `[${result.message.type}]`}
              </span>
            </button>
          ))}
          {nextCursor ? (
            <button
              type="button"
              className="w-full px-3 py-2 text-center text-xs font-medium text-brand-600 hover:bg-brand-50/70 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
              disabled={loadingMore}
              onClick={() => void runSearch({ append: true, cursor: nextCursor })}
            >
              {loadingMore
                ? t("conversationDetail.messageSearch.loadingMore")
                : t("conversationDetail.messageSearch.loadMore")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
