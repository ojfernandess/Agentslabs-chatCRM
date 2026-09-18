import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  settingsCard,
  settingsMuted,
  settingsSubtitle,
  settingsTableHead,
  settingsTableRow,
  settingsTableWrap,
  settingsTitle,
} from "@/components/settings/settingsUi";

type PolicyOverview = {
  customerServiceWindowHours: number | null;
  serviceFreeMessagesPerNumberPerMonth: number | null;
  billingActive: boolean;
  messagePolicyActive: boolean;
  serviceUsed: number | null;
  serviceRemaining: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  source: string | null;
  alerts: { threshold: 80 | 100; percent: number }[];
};

type CategoryRow = {
  category: "SERVICE" | "UTILITY" | "MARKETING" | "AUTHENTICATION";
  sent: number;
  delivered: number;
  failed: number;
  billable: number | null;
  estimatedCost: number | null;
  currency: string | null;
};

type ConsumptionResponse = {
  preset: string;
  from: string;
  to: string;
  categories: CategoryRow[];
};

type Preset = "today" | "7d" | "30d" | "month" | "custom";

const CATEGORIES: CategoryRow["category"][] = ["SERVICE", "UTILITY", "MARKETING", "AUTHENTICATION"];

function unavailable(t: (k: string) => string): string {
  return t("settings.whatsappPolicyUnavailable");
}

export function WhatsappOrgPolicyPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "pt-BR" ? "pt-BR" : "en";
  const [overview, setOverview] = useState<PolicyOverview | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionResponse | null>(null);
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [loadingConsumption, setLoadingConsumption] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return unavailable(t);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return unavailable(t);
    return d.toLocaleDateString(localeTag, { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const formatInt = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return unavailable(t);
    return n.toLocaleString(localeTag);
  };

  const formatMoney = (n: number | null | undefined, currency: string | null) => {
    if (n == null || !Number.isFinite(n)) return unavailable(t);
    try {
      return new Intl.NumberFormat(localeTag, {
        style: "currency",
        currency: currency && currency.length === 3 ? currency : "USD",
        maximumFractionDigits: 4,
      }).format(n);
    } catch {
      return `${n}`;
    }
  };

  const loadOverview = useCallback(async () => {
    setLoadingPolicy(true);
    try {
      const data = await api.get<PolicyOverview>("/whatsapp-policy/overview");
      setOverview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : unavailable(t));
      setOverview(null);
    } finally {
      setLoadingPolicy(false);
    }
  }, [t]);

  const loadConsumption = useCallback(
    async (nextPreset: Preset, from?: string, to?: string) => {
      setLoadingConsumption(true);
      try {
        const qs = new URLSearchParams({ preset: nextPreset });
        if (nextPreset === "custom" && from && to) {
          qs.set("from", from);
          qs.set("to", to);
        }
        const data = await api.get<ConsumptionResponse>(`/whatsapp-policy/consumption?${qs.toString()}`);
        setConsumption(data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : unavailable(t));
        setConsumption(null);
      } finally {
        setLoadingConsumption(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadOverview();
    void loadConsumption("month");
  }, [loadOverview, loadConsumption]);

  const usedLabel = useMemo(() => {
    if (!overview || overview.serviceUsed == null) return unavailable(t);
    if (overview.serviceFreeMessagesPerNumberPerMonth == null) {
      return formatInt(overview.serviceUsed);
    }
    return `${formatInt(overview.serviceUsed)} / ${formatInt(overview.serviceFreeMessagesPerNumberPerMonth)}`;
  }, [overview, t, localeTag]);

  const quotaLabel = overview?.serviceFreeMessagesPerNumberPerMonth != null
    ? t("settings.whatsappPolicyServiceQuotaValue").replace(
        "{n}",
        overview.serviceFreeMessagesPerNumberPerMonth.toLocaleString(localeTag),
      )
    : unavailable(t);

  return (
    <div className="space-y-6">
      <section className={settingsCard}>
        <h3 className={settingsTitle}>{t("settings.whatsappPolicyTitle")}</h3>
        <p className={clsx(settingsSubtitle, "mt-1")}>{t("settings.whatsappPolicySubtitle")}</p>

        {loadingPolicy ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyWindow")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">
                {overview?.customerServiceWindowHours != null
                  ? t("settings.whatsappPolicyWindowValue").replace(
                      "{hours}",
                      String(overview.customerServiceWindowHours),
                    )
                  : unavailable(t)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyServiceQuota")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">{quotaLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyBilling")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">
                {overview
                  ? overview.billingActive
                    ? t("settings.whatsappPolicyActive")
                    : t("settings.whatsappPolicyInactive")
                  : unavailable(t)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyMessagePolicy")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">
                {overview
                  ? overview.messagePolicyActive
                    ? t("settings.whatsappPolicyActive")
                    : t("settings.whatsappPolicyInactive")
                  : unavailable(t)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyUsed")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">{usedLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyRemaining")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">
                {formatInt(overview?.serviceRemaining ?? null)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {t("settings.whatsappPolicyPeriod")}
              </dt>
              <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">
                {overview?.periodStart && overview?.periodEnd
                  ? `${formatDate(overview.periodStart)} → ${formatDate(overview.periodEnd)}`
                  : unavailable(t)}
              </dd>
            </div>
          </dl>
        )}

        {overview?.alerts?.map((alert) => (
          <div
            key={alert.threshold}
            className={clsx(
              "mt-4 flex gap-2 rounded-lg px-3 py-2 text-sm",
              alert.threshold >= 100
                ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
                : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {alert.threshold >= 100
                ? t("settings.whatsappAlert100")
                : t("settings.whatsappAlert80")}
            </p>
          </div>
        ))}
      </section>

      <section className={settingsCard}>
        <h3 className={settingsTitle}>{t("settings.whatsappConsumptionTitle")}</h3>
        <p className={clsx(settingsSubtitle, "mt-1")}>{t("settings.whatsappConsumptionSubtitle")}</p>
        <p className={clsx(settingsMuted, "mt-1 text-xs")}>{t("settings.whatsappConsumptionEstimateHint")}</p>
        <p className={clsx(settingsMuted, "mt-1 text-xs")}>{t("settings.whatsappConsumptionBillableHint")}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["today", "7d", "30d", "month"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPreset(id);
                void loadConsumption(id);
              }}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-xs font-medium",
                preset === id
                  ? "bg-brand-600 text-white"
                  : "border border-ink-200 text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800",
              )}
            >
              {t(`settings.whatsappConsumptionFilter${id === "today" ? "Today" : id === "7d" ? "7d" : id === "30d" ? "30d" : "Month"}`)}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPreset("custom");
            void loadConsumption("custom", customFrom, customTo);
          }}
        >
          <label className="text-xs text-ink-600 dark:text-ink-300">
            {t("settings.whatsappConsumptionFrom")}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-950"
            />
          </label>
          <label className="text-xs text-ink-600 dark:text-ink-300">
            {t("settings.whatsappConsumptionTo")}
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 block rounded-lg border border-ink-200 px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-950"
            />
          </label>
          <button
            type="submit"
            disabled={!customFrom || !customTo}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-200"
          >
            {t("settings.whatsappConsumptionApply")}
          </button>
        </form>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

        {loadingConsumption ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <div className={clsx(settingsTableWrap, "mt-4")}>
            <table className="min-w-full text-sm">
              <thead className={settingsTableHead}>
                <tr>
                  <th className="px-3 py-2 text-left">{t("settings.whatsappConsumptionCategory")}</th>
                  <th className="px-3 py-2 text-right">{t("settings.whatsappConsumptionSent")}</th>
                  <th className="px-3 py-2 text-right">{t("settings.whatsappConsumptionDelivered")}</th>
                  <th className="px-3 py-2 text-right">{t("settings.whatsappConsumptionFailed")}</th>
                  <th className="px-3 py-2 text-right">{t("settings.whatsappConsumptionBillable")}</th>
                  <th className="px-3 py-2 text-right">{t("settings.whatsappConsumptionEstimatedCost")}</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => {
                  const row = consumption?.categories.find((c) => c.category === cat);
                  return (
                    <tr key={cat} className={settingsTableRow}>
                      <td className="px-3 py-2">{t(`settings.whatsappCat${cat}`)}</td>
                      <td className="px-3 py-2 text-right">{row ? formatInt(row.sent) : unavailable(t)}</td>
                      <td className="px-3 py-2 text-right">{row ? formatInt(row.delivered) : unavailable(t)}</td>
                      <td className="px-3 py-2 text-right">{row ? formatInt(row.failed) : unavailable(t)}</td>
                      <td className="px-3 py-2 text-right">
                        {row?.billable != null ? formatInt(row.billable) : unavailable(t)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row?.estimatedCost != null
                          ? formatMoney(row.estimatedCost, row.currency)
                          : unavailable(t)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
