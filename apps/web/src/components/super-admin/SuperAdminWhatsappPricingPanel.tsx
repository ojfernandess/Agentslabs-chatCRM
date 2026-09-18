import { useCallback, useEffect, useState } from "react";
import { DollarSign, Loader2, RefreshCw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type RateCardCatalog = {
  id: string;
  version: string;
  label: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  source: string;
  currency: string;
  entryCount: number;
};

type PricingRule = {
  id: string;
  market: string;
  countryCode: string;
  category: string;
  currency: string;
  price: string;
  version: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  source: string | null;
};

type BillingPolicyPhase = {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  serviceInWindowFree: boolean;
  utilityInWindowFree: boolean;
  serviceFreeTierPerNumberPerMonth: number | null;
  source: string;
};

type SummaryPayload = {
  summary: {
    totalRules: number;
    totalVolumeTiers: number;
    versions: { version: string; count: number; currency: string | null }[];
    markets: string[];
  };
  billingPolicyPhases: BillingPolicyPhase[];
  activeBillingPolicyPhase: BillingPolicyPhase;
};

export function SuperAdminWhatsappPricingPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [catalogs, setCatalogs] = useState<RateCardCatalog[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catalogRes, rulesRes, summaryRes] = await Promise.all([
        api.get<{ catalogs: RateCardCatalog[] }>("/super/whatsapp-pricing-rules/catalogs"),
        api.get<{ rules: PricingRule[] }>("/super/whatsapp-pricing-rules"),
        api.get<SummaryPayload>("/super/whatsapp-pricing-rules/summary"),
      ]);
      setCatalogs(catalogRes.catalogs);
      setSelectedCatalogId((prev) => prev || catalogRes.catalogs[0]?.id || "");
      setRules(rulesRes.rules);
      setSummary(summaryRes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.whatsappPricingLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function syncCatalog() {
    if (!selectedCatalogId) return;
    setSyncing(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.post<{
        catalogId: string;
        version: string;
        created: number;
        replaced: number;
        skipped: number;
        volumeTiersCreated: number;
        volumeTiersReplaced: number;
      }>("/super/whatsapp-pricing-rules/sync", {
        catalogId: selectedCatalogId,
        replaceVersion: true,
      });
      setSuccess(
        t("superAdmin.whatsappPricingSyncSuccess")
          .replace("{created}", String(result.created))
          .replace("{version}", result.version)
          .replace("{tiers}", String(result.volumeTiersCreated)),
      );
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.whatsappPricingSyncError"));
    } finally {
      setSyncing(false);
    }
  }

  async function deleteRule(id: string) {
    if (!window.confirm(t("superAdmin.whatsappPricingDeleteConfirm"))) return;
    setError("");
    try {
      await api.delete(`/super/whatsapp-pricing-rules/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.whatsappPricingDeleteError"));
    }
  }

  const activePhase = summary?.activeBillingPolicyPhase;

  return (
    <SuperAdminPanel className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-brand-600" />
        <div>
          <h2 className="text-base font-semibold text-ink-900">{t("superAdmin.whatsappPricingTitle")}</h2>
          <p className="text-xs text-ink-500">{t("superAdmin.whatsappPricingSubtitle")}</p>
        </div>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </p>
      ) : (
        <div className="space-y-6">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}
          {success ? (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{success}</p>
          ) : null}

          {activePhase ? (
            <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-4 text-sm">
              <p className="font-medium text-ink-900">{t("superAdmin.whatsappPricingActivePhase")}</p>
              <p className="mt-1 text-ink-700">{activePhase.label}</p>
              <ul className="mt-2 space-y-1 text-xs text-ink-600">
                <li>
                  {t("superAdmin.whatsappPricingServiceInWindow")}:{" "}
                  {activePhase.serviceInWindowFree
                    ? t("superAdmin.whatsappPricingFree")
                    : t("superAdmin.whatsappPricingBillable")}
                </li>
                <li>
                  {t("superAdmin.whatsappPricingUtilityInWindow")}:{" "}
                  {activePhase.utilityInWindowFree
                    ? t("superAdmin.whatsappPricingFree")
                    : t("superAdmin.whatsappPricingBillable")}
                </li>
                {activePhase.serviceFreeTierPerNumberPerMonth != null ? (
                  <li>
                    {t("superAdmin.whatsappPricingServiceTier").replace(
                      "{count}",
                      String(activePhase.serviceFreeTierPerNumberPerMonth),
                    )}
                  </li>
                ) : null}
              </ul>
              <a
                href={activePhase.source}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {t("superAdmin.whatsappPricingMetaDocs")} →
              </a>
            </div>
          ) : null}

          <div className="rounded-lg border border-ink-200 p-4">
            <p className="text-sm font-medium text-ink-900">{t("superAdmin.whatsappPricingSyncTitle")}</p>
            <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappPricingSyncHint")}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.whatsappPricingCatalog")}</label>
                <select
                  className="input-field mt-1 w-full text-sm"
                  value={selectedCatalogId}
                  onChange={(e) => setSelectedCatalogId(e.target.value)}
                >
                  {catalogs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.entryCount} · {c.currency})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn-primary gap-2 text-sm"
                disabled={syncing || !selectedCatalogId}
                onClick={() => void syncCatalog()}
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t("superAdmin.whatsappPricingSyncButton")}
              </button>
            </div>
            {summary ? (
              <p className="mt-3 text-xs text-ink-500">
                {t("superAdmin.whatsappPricingDbSummary").replace("{total}", String(summary.summary.totalRules))}
                {summary.summary.totalVolumeTiers > 0
                  ? ` · ${t("superAdmin.whatsappPricingVolumeTiersSummary").replace(
                      "{total}",
                      String(summary.summary.totalVolumeTiers),
                    )}`
                  : ""}
                {summary.summary.versions.length > 0
                  ? ` · ${summary.summary.versions.map((v) => `${v.version} (${v.count})`).join(", ")}`
                  : ""}
              </p>
            ) : null}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-900">{t("superAdmin.whatsappPricingRulesTable")}</p>
              <button type="button" className="btn-secondary text-xs" onClick={() => void loadAll()}>
                {t("superAdmin.whatsappPricingRefresh")}
              </button>
            </div>
            {rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500">
                {t("superAdmin.whatsappPricingNoRules")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ink-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-ink-50 text-ink-600">
                    <tr>
                      <th className="px-3 py-2">{t("superAdmin.whatsappPricingColMarket")}</th>
                      <th className="px-3 py-2">{t("superAdmin.whatsappPricingColCategory")}</th>
                      <th className="px-3 py-2">{t("superAdmin.whatsappPricingColPrice")}</th>
                      <th className="px-3 py-2">{t("superAdmin.whatsappPricingColVersion")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {rules.slice(0, 100).map((rule) => (
                      <tr key={rule.id} className="text-ink-800">
                        <td className="px-3 py-2">
                          {rule.market}{" "}
                          <span className="text-ink-400">+{rule.countryCode}</span>
                        </td>
                        <td className="px-3 py-2">{rule.category}</td>
                        <td className="px-3 py-2 font-mono">
                          {Number(rule.price).toLocaleString(localeTag, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 6,
                          })}{" "}
                          {rule.currency}
                        </td>
                        <td className="px-3 py-2">{rule.version ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className={clsx("rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600")}
                            aria-label={t("common.delete")}
                            onClick={() => void deleteRule(rule.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </SuperAdminPanel>
  );
}
