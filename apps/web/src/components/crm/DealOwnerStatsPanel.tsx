import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { subDays, format } from "date-fns";
import { BarChart3, ChevronLeft, TrendingUp, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { APP_CURRENCY, formatCurrencyFromCents } from "@/lib/currency";
import type { DealCategoryContext } from "@/components/crm/DealCategoryFieldsForm";

export type DealOwnerSummaryRow = {
  ownerId: string | null;
  ownerName: string;
  wonAmountCents: number;
  openAmountCents: number;
  lostAmountCents: number;
  wonCount: number;
  openCount: number;
  lostCount: number;
  dealCount: number;
};

export type DealFieldStatRow = {
  fieldKey: string;
  labelPt: string;
  labelEn: string;
  type: string;
  kind: "select" | "numeric" | "text" | "boolean";
  options?: Array<{ value: string; label: string; count: number }>;
  numeric?: { sum: number; avg: number; count: number; unit?: "cents" | "number" };
  filledCount?: number;
};

export type DealProductStatRow = {
  productId: string | null;
  productName: string;
  count: number;
  totalCents: number;
};

export type DealOwnerStatsPayload = {
  activeCategory: string;
  categoryLabelPt: string;
  categoryLabelEn: string;
  from: string;
  to: string;
  filterCategory: string | null;
  filterOwnerId: string | null;
  summary: {
    wonAmountCents: number;
    openAmountCents: number;
    lostAmountCents: number;
    wonCount: number;
    openCount: number;
    lostCount: number;
    dealCount: number;
  };
  byOwner: DealOwnerSummaryRow[];
  fieldStats: DealFieldStatRow[];
  productStats: DealProductStatRow[];
  recentDeals: Array<{
    id: string;
    name: string;
    status: string;
    amountCents: number;
    currency: string;
    categoryData: Record<string, unknown> | null;
    createdAt: string;
    primaryContact: { id: string; name: string } | null;
  }>;
};

type Props = {
  mode: "admin" | "self";
  categoryContext: DealCategoryContext | null;
  categoryFilter: string;
  onCategoryFilterChange?: (value: string) => void;
};

function defaultFromDate(): string {
  return format(subDays(new Date(), 29), "yyyy-MM-dd");
}

function defaultToDate(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function toIsoStart(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function toIsoEnd(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999`).toISOString();
}

function statusLabel(status: string, t: (k: string) => string): string {
  if (status === "WON") return t("dealsPage.statsStatusWon");
  if (status === "OPEN") return t("dealsPage.statsStatusOpen");
  if (status === "LOST") return t("dealsPage.statsStatusLost");
  return status;
}

export function DealOwnerStatsPanel({ mode, categoryContext, categoryFilter, onCategoryFilterChange }: Props) {
  const { t, locale } = useI18n();
  const pt = locale.startsWith("pt");
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<DealOwnerStatsPayload | null>(null);
  const [detail, setDetail] = useState<DealOwnerStatsPayload | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedOwnerName, setSelectedOwnerName] = useState("");

  const fmtMoney = (cents: number, currency = APP_CURRENCY) => formatCurrencyFromCents(cents, currency);

  const categoryLabel = useMemo(() => {
    if (!overview) return "";
    return pt ? overview.categoryLabelPt : overview.categoryLabelEn;
  }, [overview, pt]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: toIsoStart(fromDate),
        to: toIsoEnd(toDate),
      });
      if (categoryFilter) params.set("category", categoryFilter);

      const endpoint = mode === "admin" ? "/crm/deals/stats-by-owner" : "/crm/deals/my-stats";
      const res = await api.get<{ data: DealOwnerStatsPayload }>(`${endpoint}?${params.toString()}`);
      setOverview(res.data);
      if (mode === "self") {
        setDetail(res.data);
      }
    } catch {
      setOverview(null);
      if (mode === "self") setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, fromDate, mode, toDate]);

  const loadOwnerDetail = useCallback(
    async (ownerId: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          from: toIsoStart(fromDate),
          to: toIsoEnd(toDate),
          ownerId,
        });
        if (categoryFilter) params.set("category", categoryFilter);
        const res = await api.get<{ data: DealOwnerStatsPayload }>(
          `/crm/deals/stats-by-owner?${params.toString()}`,
        );
        setDetail(res.data);
      } catch {
        setDetail(null);
      } finally {
        setLoading(false);
      }
    },
    [categoryFilter, fromDate, toDate],
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (mode === "admin" && selectedOwnerId) {
      void loadOwnerDetail(selectedOwnerId);
    }
  }, [loadOwnerDetail, mode, selectedOwnerId]);

  const activeData = mode === "self" ? detail : detail ?? overview;
  const showOwnerGrid = mode === "admin" && !selectedOwnerId;

  const renderKpiCards = (data: DealOwnerStatsPayload) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">{t("dealsPage.statsWonTotal")}</p>
        <p className="mt-1 text-xl font-bold text-emerald-900 dark:text-emerald-100">
          {fmtMoney(data.summary.wonAmountCents)}
        </p>
        <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-300/80">
          {data.summary.wonCount} {t("dealsPage.statsDealsCount")}
        </p>
      </div>
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
        <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{t("dealsPage.statsOpenTotal")}</p>
        <p className="mt-1 text-xl font-bold text-amber-900 dark:text-amber-100">
          {fmtMoney(data.summary.openAmountCents)}
        </p>
        <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
          {data.summary.openCount} {t("dealsPage.statsDealsCount")}
        </p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/50">
        <p className="text-xs font-medium text-gray-600 dark:text-ink-300">{t("dealsPage.statsTotalDeals")}</p>
        <p className="mt-1 text-xl font-bold text-gray-900 dark:text-ink-50">{data.summary.dealCount}</p>
        {data.summary.lostCount > 0 ? (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-ink-400">
            {data.summary.lostCount} {t("dealsPage.statsStatusLost")}
          </p>
        ) : null}
      </div>
    </div>
  );

  const renderFieldStats = (fields: DealFieldStatRow[]) => {
    if (fields.length === 0) {
      return (
        <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-ink-700 dark:text-ink-400">
          {t("dealsPage.statsNoFieldData")}
        </p>
      );
    }
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((field) => {
          const label = pt ? field.labelPt : field.labelEn;
          return (
            <div
              key={field.fieldKey}
              className="rounded-xl border border-gray-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/50"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-ink-50">{label}</p>
                {field.filledCount != null ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-ink-800 dark:text-ink-300">
                    {field.filledCount}
                  </span>
                ) : null}
              </div>
              {field.kind === "select" || field.kind === "boolean" ? (
                <ul className="space-y-1.5">
                  {(field.options ?? []).map((opt) => (
                    <li key={opt.value} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-gray-700 dark:text-ink-200">{opt.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-brand-700 dark:text-brand-300">
                        {opt.count}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : field.kind === "numeric" && field.numeric ? (
                <div className="space-y-1 text-sm text-gray-700 dark:text-ink-200">
                  {field.numeric.unit === "cents" ? (
                    <>
                      <p>
                        {t("dealsPage.statsSum")}:{" "}
                        <span className="font-semibold">{fmtMoney(field.numeric.sum)}</span>
                      </p>
                      <p>
                        {t("dealsPage.statsAvg")}:{" "}
                        <span className="font-semibold">{fmtMoney(Math.round(field.numeric.avg))}</span>
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        {t("dealsPage.statsSum")}:{" "}
                        <span className="font-semibold">{field.numeric.sum.toLocaleString(locale)}</span>
                      </p>
                      <p>
                        {t("dealsPage.statsAvg")}:{" "}
                        <span className="font-semibold">
                          {field.numeric.avg.toLocaleString(locale, { maximumFractionDigits: 1 })}
                        </span>
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-600 dark:text-ink-300">
                  {t("dealsPage.statsFilledCount")}: {field.filledCount ?? 0}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderProductStats = (products: DealProductStatRow[]) => {
    if (products.length === 0) return null;
    return (
      <section className="mt-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-ink-50">
          <TrendingUp className="h-4 w-4 text-brand-600" />
          {t("dealsPage.statsProducts")}
        </h3>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-ink-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-ink-800/60 dark:text-ink-400">
              <tr>
                <th className="px-4 py-2">{t("dealsPage.statsProductName")}</th>
                <th className="px-4 py-2">{t("dealsPage.statsProductQty")}</th>
                <th className="px-4 py-2 text-right">{t("dealsPage.statsProductTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={`${p.productId ?? "custom"}-${p.productName}`} className="border-t border-gray-100 dark:border-ink-800">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-ink-50">{p.productName}</td>
                  <td className="px-4 py-2 tabular-nums text-gray-700 dark:text-ink-200">{p.count}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-ink-50">
                    {fmtMoney(p.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const renderRecentDeals = (deals: DealOwnerStatsPayload["recentDeals"]) => {
    if (deals.length === 0) return null;
    return (
      <section className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-ink-50">{t("dealsPage.statsRecentDeals")}</h3>
        <ul className="space-y-2">
          {deals.slice(0, 10).map((deal) => (
            <li
              key={deal.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-ink-700 dark:bg-ink-900/50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900 dark:text-ink-50">{deal.name}</p>
                <p className="text-xs text-gray-500 dark:text-ink-400">
                  {deal.primaryContact?.name ?? "—"} · {format(new Date(deal.createdAt), "dd/MM/yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                    deal.status === "WON" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
                    deal.status === "OPEN" && "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
                    deal.status === "LOST" && "bg-gray-100 text-gray-700 dark:bg-ink-800 dark:text-ink-300",
                  )}
                >
                  {statusLabel(deal.status, t)}
                </span>
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-ink-50">
                  {fmtMoney(deal.amountCents, deal.currency)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/50">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-ink-300">{t("dealsPage.statsFrom")}</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-ink-300">{t("dealsPage.statsTo")}</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
          />
        </div>
        {categoryContext && categoryContext.catalog.length > 1 && onCategoryFilterChange ? (
          <div className="min-w-[10rem] flex-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-ink-300">
              {t("dealsPage.filterCategory")}
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => onCategoryFilterChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
            >
              <option value="">{t("dealsPage.filterCategoryAll")}</option>
              {categoryContext.catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {pt ? c.labelPt : c.labelEn}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {categoryLabel ? (
          <p className="ml-auto text-xs text-gray-500 dark:text-ink-400">
            {t("dealsPage.statsActiveCategory")}: <span className="font-medium">{categoryLabel}</span>
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
        </div>
      ) : !overview ? (
        <p className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-ink-600 dark:text-ink-400">
          {t("dealsPage.statsLoadError")}
        </p>
      ) : showOwnerGrid ? (
        <>
          {renderKpiCards(overview)}
          <section className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-ink-50">
              <Users className="h-4 w-4 text-brand-600" />
              {t("dealsPage.statsByAttendant")}
            </h3>
            {overview.byOwner.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-ink-700 dark:text-ink-400">
                {t("dealsPage.statsEmptyOwners")}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {overview.byOwner.map((owner) => (
                  <button
                    key={owner.ownerId ?? "none"}
                    type="button"
                    onClick={() => {
                      if (!owner.ownerId) return;
                      setSelectedOwnerId(owner.ownerId);
                      setSelectedOwnerName(owner.ownerName);
                    }}
                    disabled={!owner.ownerId}
                    className={clsx(
                      "rounded-xl border p-4 text-left transition",
                      owner.ownerId
                        ? "border-gray-200 bg-white hover:border-brand-300 hover:shadow-sm dark:border-ink-700 dark:bg-ink-900/50 dark:hover:border-brand-700"
                        : "cursor-default border-gray-100 bg-gray-50 opacity-70 dark:border-ink-800 dark:bg-ink-900/30",
                    )}
                  >
                    <p className="font-semibold text-gray-900 dark:text-ink-50">{owner.ownerName}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-gray-500 dark:text-ink-400">{t("dealsPage.statsWonTotal")}</p>
                        <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                          {fmtMoney(owner.wonAmountCents)}
                        </p>
                        <p className="text-gray-400">
                          {owner.wonCount} {t("dealsPage.statsDealsCount")}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 dark:text-ink-400">{t("dealsPage.statsOpenTotal")}</p>
                        <p className="font-semibold text-amber-700 dark:text-amber-300">
                          {fmtMoney(owner.openAmountCents)}
                        </p>
                        <p className="text-gray-400">
                          {owner.openCount} {t("dealsPage.statsDealsCount")}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      ) : activeData ? (
        <>
          {mode === "admin" && selectedOwnerId ? (
            <button
              type="button"
              onClick={() => {
                setSelectedOwnerId(null);
                setSelectedOwnerName("");
                setDetail(null);
              }}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("dealsPage.statsBackToList")}
            </button>
          ) : null}
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-ink-50">
              {mode === "admin" ? selectedOwnerName : t("dealsPage.statsMyDashboard")}
            </h2>
          </div>
          {renderKpiCards(activeData)}
          <section className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-ink-50">
              {t("dealsPage.statsCategoryBreakdown")}
            </h3>
            {renderFieldStats(activeData.fieldStats)}
          </section>
          {renderProductStats(activeData.productStats)}
          {renderRecentDeals(activeData.recentDeals)}
        </>
      ) : null}
    </div>
  );
}
