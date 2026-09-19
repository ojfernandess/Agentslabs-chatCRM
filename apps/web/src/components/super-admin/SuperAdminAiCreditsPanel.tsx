import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Coins, Loader2, Pencil, Plus } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { formatAiCreditsAdminUnits } from "@/lib/aiCreditsDisplay";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";
import { MoneyCentsInput } from "@/components/billing/MoneyCentsInput";

type AiCreditPackageRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  badgeLabel?: string | null;
  creditAmount: string;
  amountCents: number;
  currency: string;
  stripePriceId: string | null;
  displayOrder: number;
  isActive: boolean;
};

type AiCreditPurchaseRow = {
  id: string;
  organizationId: string;
  organizationName?: string | null;
  packageName: string;
  packageSlug: string;
  paymentProvider: string;
  status: string;
  creditAmount: string;
  amountCents: number;
  currency: string;
  completedAt: string | null;
  createdAt: string;
};

type AiCreditsTab = "packages" | "packages_inactive" | "purchases" | "clients";

type OrgOption = { id: string; name: string; slug: string };

type AiCreditsClientSummary = {
  organization: { id: string; name: string; aiBillingMode: string };
  creditsAvailable: string;
  creditsConsumed: string;
  providerCostUsd: string;
  convertedCostBrl: string;
  billedBrl: string;
  marginBrl: string;
  usdBrlRate: number;
  usageRecordCount: number;
};

const EMPTY_PACKAGE_FORM = {
  slug: "",
  name: "",
  description: "",
  badgeLabel: "",
  creditAmount: "10",
  amountCents: "1000",
  currency: "USD",
  stripePriceId: "",
  displayOrder: "0",
  isActive: true,
};

function formatMoney(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatUsd(value: string, locale: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);
}

function formatBrl(value: string, locale: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(amount);
}

function SummaryMetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale);
}

function purchaseStatusLabel(status: string, t: (key: string) => string): string {
  const key = `superAdmin.aiCreditsPurchaseStatus_${status.toLowerCase()}`;
  const translated = t(key);
  return translated !== key ? translated : status;
}

export function SuperAdminAiCreditsPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const [tab, setTab] = useState<AiCreditsTab>("packages");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [packages, setPackages] = useState<AiCreditPackageRow[]>([]);
  const [purchases, setPurchases] = useState<AiCreditPurchaseRow[]>([]);
  const [purchaseStatus, setPurchaseStatus] = useState("");
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<AiCreditPackageRow | null>(null);
  const [packageForm, setPackageForm] = useState(EMPTY_PACKAGE_FORM);
  const [packageSaving, setPackageSaving] = useState(false);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [clientSummary, setClientSummary] = useState<AiCreditsClientSummary | null>(null);
  const [clientsLoading, setClientsLoading] = useState(false);

  const loadPackages = useCallback(async () => {
    const res = await api.get<{ packages: AiCreditPackageRow[] }>("/super/billing/ai-credits/packages");
    setPackages(res.packages);
  }, []);

  const loadPurchases = useCallback(async () => {
    const params = new URLSearchParams();
    if (purchaseStatus.trim()) params.set("status", purchaseStatus.trim());
    params.set("limit", "100");
    const qs = params.toString();
    const res = await api.get<{ purchases: AiCreditPurchaseRow[] }>(
      `/super/billing/ai-credits/purchases${qs ? `?${qs}` : ""}`,
    );
    setPurchases(res.purchases);
  }, [purchaseStatus]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPackages(), loadPurchases()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.aiCreditsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [loadPackages, loadPurchases, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab !== "purchases") return;
    void loadPurchases().catch(() => {});
  }, [tab, loadPurchases]);

  const loadOrganizations = useCallback(async () => {
    const res = await api.get<{ organizations: OrgOption[] }>("/super/organizations");
    const rows = [...res.organizations].sort((a, b) => a.name.localeCompare(b.name));
    setOrganizations(rows);
    if (!selectedOrganizationId && rows.length > 0) {
      setSelectedOrganizationId(rows[0]!.id);
    }
  }, [selectedOrganizationId]);

  const loadClientSummary = useCallback(async (organizationId: string) => {
    if (!organizationId) {
      setClientSummary(null);
      return;
    }
    setClientsLoading(true);
    setError("");
    try {
      const res = await api.get<AiCreditsClientSummary>(
        `/super/billing/ai-credits/organizations/${organizationId}/summary`,
      );
      setClientSummary(res);
    } catch (e) {
      setClientSummary(null);
      setError(e instanceof ApiError ? e.message : t("superAdmin.aiCreditsLoadError"));
    } finally {
      setClientsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (tab !== "clients") return;
    void loadOrganizations().catch((e) => {
      setError(e instanceof ApiError ? e.message : t("superAdmin.aiCreditsLoadError"));
    });
  }, [tab, loadOrganizations, t]);

  useEffect(() => {
    if (tab !== "clients" || !selectedOrganizationId) return;
    void loadClientSummary(selectedOrganizationId);
  }, [tab, selectedOrganizationId, loadClientSummary]);

  const activePackages = useMemo(
    () =>
      [...packages]
        .filter((pkg) => pkg.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [packages],
  );

  const inactivePackages = useMemo(
    () =>
      [...packages]
        .filter((pkg) => !pkg.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [packages],
  );

  const renderPackageTable = (rows: AiCreditPackageRow[], emptyLabel: string) => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">{t("superAdmin.billingColPlan")}</th>
            <th className="px-4 py-3">{t("superAdmin.aiCreditsColCredits")}</th>
            <th className="px-4 py-3">{t("superAdmin.billingColPrice")}</th>
            <th className="px-4 py-3">Stripe Price</th>
            <th className="px-4 py-3">{t("superAdmin.aiCreditsColOrder")}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((pkg) => (
              <tr key={pkg.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{pkg.name}</div>
                  <div className="text-xs text-slate-500">{pkg.slug}</div>
                </td>
                <td className="px-4 py-3">{formatAiCreditsAdminUnits(pkg.creditAmount, localeTag)}</td>
                <td className="px-4 py-3">{formatMoney(pkg.amountCents, pkg.currency, localeTag)}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{pkg.stripePriceId || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{pkg.displayOrder}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => openEditPackage(pkg)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("superAdmin.billingEditPlan")}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const openCreatePackage = () => {
    setEditingPackage(null);
    setPackageForm(EMPTY_PACKAGE_FORM);
    setPackageModalOpen(true);
  };

  const openEditPackage = (pkg: AiCreditPackageRow) => {
    setEditingPackage(pkg);
    setPackageForm({
      slug: pkg.slug,
      name: pkg.name,
      description: pkg.description ?? "",
      badgeLabel: pkg.badgeLabel ?? "",
      creditAmount: pkg.creditAmount,
      amountCents: String(pkg.amountCents),
      currency: pkg.currency,
      stripePriceId: pkg.stripePriceId ?? "",
      displayOrder: String(pkg.displayOrder),
      isActive: pkg.isActive,
    });
    setPackageModalOpen(true);
  };

  const submitPackage = async (e: FormEvent) => {
    e.preventDefault();
    setPackageSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        slug: packageForm.slug.trim(),
        name: packageForm.name.trim(),
        description: packageForm.description.trim() || null,
        badgeLabel: packageForm.badgeLabel.trim() || null,
        creditAmount: packageForm.creditAmount.trim(),
        amountCents: Number(packageForm.amountCents) || 0,
        currency: packageForm.currency.trim().toUpperCase(),
        stripePriceId: packageForm.stripePriceId.trim() || null,
        displayOrder: Number(packageForm.displayOrder) || 0,
        isActive: packageForm.isActive,
      };
      if (editingPackage) {
        const res = await api.patch<{ package: AiCreditPackageRow }>(
          `/super/billing/ai-credits/packages/${editingPackage.id}`,
          payload,
        );
        setPackages((rows) => rows.map((row) => (row.id === editingPackage.id ? res.package : row)));
      } else {
        await api.post("/super/billing/ai-credits/packages", payload);
        await loadPackages();
      }
      setPackageModalOpen(false);
      setSuccess(t("superAdmin.aiCreditsPackageSaved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setPackageSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(["packages", "packages_inactive", "purchases", "clients"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-medium",
              tab === id
                ? "bg-brand-600 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {t(`superAdmin.aiCreditsTab_${id}`)}
            {id === "packages" && activePackages.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-xs">{activePackages.length}</span>
            ) : null}
            {id === "packages_inactive" && inactivePackages.length > 0 ? (
              <span
                className={clsx(
                  "ml-1.5 rounded-full px-1.5 text-xs",
                  tab === id ? "bg-white/20" : "bg-slate-100 text-slate-600",
                )}
              >
                {inactivePackages.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      {tab === "packages" && !loading ? (
        <SuperAdminPanel className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <Coins className="h-4 w-4" />
              {t("superAdmin.aiCreditsPackagesActiveTitle")}
            </div>
            <button type="button" onClick={openCreatePackage} className="btn-primary inline-flex items-center gap-1.5 text-sm">
              <Plus className="h-4 w-4" />
              {t("superAdmin.aiCreditsPackageCreate")}
            </button>
          </div>
          {renderPackageTable(activePackages, t("superAdmin.aiCreditsPackagesActiveEmpty"))}
        </SuperAdminPanel>
      ) : null}

      {tab === "packages_inactive" && !loading ? (
        <SuperAdminPanel className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <Coins className="h-4 w-4" />
              {t("superAdmin.aiCreditsPackagesInactiveTitle")}
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("superAdmin.aiCreditsPackagesInactiveHint")}</p>
          </div>
          {renderPackageTable(inactivePackages, t("superAdmin.aiCreditsPackagesInactiveEmpty"))}
        </SuperAdminPanel>
      ) : null}

      {tab === "purchases" && !loading ? (
        <SuperAdminPanel className="overflow-hidden p-0">
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.billingFilterStatus")}</label>
              <select
                value={purchaseStatus}
                onChange={(e) => setPurchaseStatus(e.target.value)}
                className="input-field mt-1"
              >
                <option value="">{t("superAdmin.billingAllStatuses")}</option>
                <option value="COMPLETED">{purchaseStatusLabel("COMPLETED", t)}</option>
                <option value="PENDING">{purchaseStatusLabel("PENDING", t)}</option>
                <option value="FAILED">{purchaseStatusLabel("FAILED", t)}</option>
                <option value="CANCELED">{purchaseStatusLabel("CANCELED", t)}</option>
              </select>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void loadPurchases()}>
              {t("common.search")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("superAdmin.billingColOrganization")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPlan")}</th>
                  <th className="px-4 py-3">{t("superAdmin.aiCreditsColCredits")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPrice")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStatus")}</th>
                  <th className="px-4 py-3">{t("superAdmin.aiCreditsColProvider")}</th>
                  <th className="px-4 py-3">{t("superAdmin.aiCreditsColDate")}</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.organizationName ?? row.organizationId}</div>
                    </td>
                    <td className="px-4 py-3">{row.packageName}</td>
                    <td className="px-4 py-3">{formatAiCreditsAdminUnits(row.creditAmount, localeTag)}</td>
                    <td className="px-4 py-3">{formatMoney(row.amountCents, row.currency, localeTag)}</td>
                    <td className="px-4 py-3">{purchaseStatusLabel(row.status, t)}</td>
                    <td className="px-4 py-3 uppercase text-xs text-slate-600">{row.paymentProvider}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDateTime(row.completedAt ?? row.createdAt, localeTag)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SuperAdminPanel>
      ) : null}

      {tab === "clients" && !loading ? (
        <SuperAdminPanel className="p-4 sm:p-6">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-slate-900">{t("superAdmin.aiCreditsClientsTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("superAdmin.aiCreditsClientsIntro")}</p>

            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-600">
                {t("superAdmin.aiCreditsClientsSelectOrg")}
              </label>
              <select
                value={selectedOrganizationId}
                onChange={(e) => setSelectedOrganizationId(e.target.value)}
                className="input-field mt-1 w-full max-w-md"
              >
                <option value="">{t("superAdmin.aiCreditsClientsSelectPlaceholder")}</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>

            {clientsLoading ? (
              <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : null}

            {!clientsLoading && !selectedOrganizationId ? (
              <p className="mt-6 text-sm text-slate-500">{t("superAdmin.aiCreditsClientsEmpty")}</p>
            ) : null}

            {!clientsLoading && clientSummary && selectedOrganizationId ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                <p className="text-sm text-slate-600">
                  {t("superAdmin.aiCreditsClientsLabel")}:{" "}
                  <span className="font-semibold text-slate-900">{clientSummary.organization.name}</span>
                </p>

                {clientSummary.organization.aiBillingMode !== "PLATFORM_CREDITS" ? (
                  <p className="mt-4 text-sm text-amber-700">{t("superAdmin.aiCreditsClientsNotPlatformCredits")}</p>
                ) : (
                  <div className="mt-4">
                    <SummaryMetricRow
                      label={t("superAdmin.aiCreditsClientsAvailable")}
                      value={formatAiCreditsAdminUnits(clientSummary.creditsAvailable, localeTag)}
                    />
                    <SummaryMetricRow
                      label={t("superAdmin.aiCreditsClientsConsumed")}
                      value={formatAiCreditsAdminUnits(clientSummary.creditsConsumed, localeTag)}
                    />
                    <SummaryMetricRow
                      label={t("superAdmin.aiCreditsClientsOpenAiCost")}
                      value={formatUsd(clientSummary.providerCostUsd, localeTag)}
                    />
                    <SummaryMetricRow
                      label={t("superAdmin.aiCreditsClientsConvertedCost")}
                      value={formatBrl(clientSummary.convertedCostBrl, localeTag)}
                    />
                    <SummaryMetricRow
                      label={t("superAdmin.aiCreditsClientsBilled")}
                      value={formatBrl(clientSummary.billedBrl, localeTag)}
                    />
                    <SummaryMetricRow
                      label={t("superAdmin.aiCreditsClientsMargin")}
                      value={formatBrl(clientSummary.marginBrl, localeTag)}
                    />
                  </div>
                )}

                <p className="mt-4 text-xs text-slate-500">
                  {t("superAdmin.aiCreditsClientsUsageCount").replace(
                    "{count}",
                    String(clientSummary.usageRecordCount),
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("superAdmin.aiCreditsClientsFxHint").replace(
                    "{rate}",
                    new Intl.NumberFormat(localeTag, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
                      clientSummary.usdBrlRate,
                    ),
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </SuperAdminPanel>
      ) : null}

      {packageModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-h-[90vh] w-full max-w-xl overflow-auto p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900">
              {editingPackage ? t("superAdmin.aiCreditsPackageEdit") : t("superAdmin.aiCreditsPackageCreate")}
            </h3>
            <form onSubmit={(e) => void submitPackage(e)} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-ink-600">Slug</label>
                <input
                  value={packageForm.slug}
                  onChange={(e) => setPackageForm((f) => ({ ...f, slug: e.target.value }))}
                  className="input-field mt-1"
                  required
                  disabled={Boolean(editingPackage)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPlan")}</label>
                <input
                  value={packageForm.name}
                  onChange={(e) => setPackageForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-field mt-1"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingDescription")}</label>
                <textarea
                  value={packageForm.description}
                  onChange={(e) => setPackageForm((f) => ({ ...f, description: e.target.value }))}
                  className="input-field mt-1 min-h-[72px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingBadgeLabel")}</label>
                <input
                  value={packageForm.badgeLabel}
                  onChange={(e) => setPackageForm((f) => ({ ...f, badgeLabel: e.target.value }))}
                  className="input-field mt-1"
                  placeholder={t("superAdmin.billingBadgeLabelPlaceholder")}
                  maxLength={80}
                />
                <p className="mt-1 text-xs text-ink-500">{t("superAdmin.billingBadgeLabelHint")}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.aiCreditsColCredits")}</label>
                <input
                  value={packageForm.creditAmount}
                  onChange={(e) => setPackageForm((f) => ({ ...f, creditAmount: e.target.value }))}
                  className="input-field mt-1"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPrice")}</label>
                <MoneyCentsInput
                  className="mt-1"
                  currency={packageForm.currency || "USD"}
                  valueCents={packageForm.amountCents}
                  onChangeCents={(amountCents) => setPackageForm((f) => ({ ...f, amountCents }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">Currency</label>
                <select
                  value={packageForm.currency}
                  onChange={(e) => setPackageForm((f) => ({ ...f, currency: e.target.value }))}
                  className="input-field mt-1"
                >
                  <option value="USD">USD</option>
                  <option value="BRL">BRL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">Stripe Price ID</label>
                <input
                  value={packageForm.stripePriceId}
                  onChange={(e) => setPackageForm((f) => ({ ...f, stripePriceId: e.target.value }))}
                  className="input-field mt-1 font-mono text-xs"
                  placeholder="price_..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.aiCreditsColOrder")}</label>
                <input
                  type="number"
                  value={packageForm.displayOrder}
                  onChange={(e) => setPackageForm((f) => ({ ...f, displayOrder: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={packageForm.isActive}
                    onChange={(e) => setPackageForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  {t("superAdmin.billingActive")}
                </label>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setPackageModalOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={packageSaving}>
                  {packageSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
