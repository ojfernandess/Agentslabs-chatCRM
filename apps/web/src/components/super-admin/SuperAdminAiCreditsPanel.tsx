import { useCallback, useEffect, useState, type FormEvent } from "react";
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

type AiCreditsTab = "packages" | "purchases";

const EMPTY_PACKAGE_FORM = {
  slug: "",
  name: "",
  description: "",
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

function formatCredits(value: string, locale: string): string {
  return formatAiCreditsAdminUnits(value, locale);
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
        {(["packages", "purchases"] as const).map((id) => (
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
              {t("superAdmin.aiCreditsPackagesTitle")}
            </div>
            <button type="button" onClick={openCreatePackage} className="btn-primary inline-flex items-center gap-1.5 text-sm">
              <Plus className="h-4 w-4" />
              {t("superAdmin.aiCreditsPackageCreate")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("superAdmin.billingColPlan")}</th>
                  <th className="px-4 py-3">{t("superAdmin.aiCreditsColCredits")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPrice")}</th>
                  <th className="px-4 py-3">Stripe Price</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStatus")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{pkg.name}</div>
                      <div className="text-xs text-slate-500">{pkg.slug}</div>
                    </td>
                    <td className="px-4 py-3">{formatCredits(pkg.creditAmount, localeTag)}</td>
                    <td className="px-4 py-3">{formatMoney(pkg.amountCents, pkg.currency, localeTag)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{pkg.stripePriceId || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          pkg.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {pkg.isActive ? t("superAdmin.billingActive") : t("superAdmin.billingInactive")}
                      </span>
                    </td>
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
                ))}
              </tbody>
            </table>
          </div>
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
                    <td className="px-4 py-3">{formatCredits(row.creditAmount, localeTag)}</td>
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
