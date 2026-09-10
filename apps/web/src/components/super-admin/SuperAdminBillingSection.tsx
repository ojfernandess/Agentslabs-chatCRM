import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CreditCard, Loader2, Pencil, Plus } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPageHeader, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  currency: string;
  amountCents: number;
  interval: string;
  trialDays: number | null;
  displayOrder: number;
  isActive: boolean;
  stripeProductId: string | null;
  stripePriceId: string | null;
  legacyPlanTier: string | null;
  limits: Record<string, number | null | undefined>;
  features: Record<string, boolean | undefined>;
  subscriptionCount: number;
};

type SubscriptionRow = {
  id: string;
  organizationId: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    planTier: string;
    billingEmail: string | null;
    isActive: boolean;
    stripeCustomerId: string | null;
  };
  plan: {
    id: string;
    slug: string;
    name: string;
    amountCents: number;
    currency: string;
    interval: string;
  } | null;
  status: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};

type BillingTab = "plans" | "subscriptions" | "settings";

const EMPTY_PLAN_FORM = {
  slug: "",
  name: "",
  description: "",
  currency: "BRL",
  amountCents: "0",
  interval: "month",
  trialDays: "",
  displayOrder: "0",
  isActive: true,
  stripeProductId: "",
  stripePriceId: "",
  legacyPlanTier: "",
  limitsJson: '{\n  "agents": 3,\n  "automations": 10,\n  "contacts": 1000,\n  "messages": null\n}',
  featuresJson: '{\n  "rag": false,\n  "api": false,\n  "mcp": false\n}',
};

function formatMoney(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale);
}

export function SuperAdminBillingSection() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const [tab, setTab] = useState<BillingTab>("plans");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subTotal, setSubTotal] = useState(0);
  const [subQuery, setSubQuery] = useState("");
  const [subStatus, setSubStatus] = useState("");
  const [gracePeriodDays, setGracePeriodDays] = useState("7");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN_FORM);
  const [planSaving, setPlanSaving] = useState(false);

  const loadPlans = useCallback(async () => {
    const res = await api.get<{ plans: PlanRow[] }>("/super/billing/plans");
    setPlans(res.plans);
  }, []);

  const loadSubscriptions = useCallback(async () => {
    const params = new URLSearchParams();
    if (subQuery.trim()) params.set("q", subQuery.trim());
    if (subStatus.trim()) params.set("status", subStatus.trim());
    const qs = params.toString();
    const res = await api.get<{ subscriptions: SubscriptionRow[]; total: number }>(
      `/super/billing/subscriptions${qs ? `?${qs}` : ""}`,
    );
    setSubscriptions(res.subscriptions);
    setSubTotal(res.total);
  }, [subQuery, subStatus]);

  const loadSettings = useCallback(async () => {
    const res = await api.get<{ settings: { gracePeriodDays: number } }>("/super/billing/settings");
    setGracePeriodDays(String(res.settings.gracePeriodDays));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPlans(), loadSubscriptions(), loadSettings()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingLoadError"));
    } finally {
      setLoading(false);
    }
  }, [loadPlans, loadSubscriptions, loadSettings, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab !== "subscriptions") return;
    void loadSubscriptions().catch(() => {});
  }, [tab, loadSubscriptions]);

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm(EMPTY_PLAN_FORM);
    setPlanModalOpen(true);
  };

  const openEditPlan = (plan: PlanRow) => {
    setEditingPlan(plan);
    setPlanForm({
      slug: plan.slug,
      name: plan.name,
      description: plan.description ?? "",
      currency: plan.currency,
      amountCents: String(plan.amountCents),
      interval: plan.interval,
      trialDays: plan.trialDays != null ? String(plan.trialDays) : "",
      displayOrder: String(plan.displayOrder),
      isActive: plan.isActive,
      stripeProductId: plan.stripeProductId ?? "",
      stripePriceId: plan.stripePriceId ?? "",
      legacyPlanTier: plan.legacyPlanTier ?? "",
      limitsJson: JSON.stringify(plan.limits, null, 2),
      featuresJson: JSON.stringify(plan.features, null, 2),
    });
    setPlanModalOpen(true);
  };

  const submitPlan = async (e: FormEvent) => {
    e.preventDefault();
    setPlanSaving(true);
    setError("");
    try {
      let limits: Record<string, unknown> = {};
      let features: Record<string, unknown> = {};
      try {
        limits = JSON.parse(planForm.limitsJson) as Record<string, unknown>;
        features = JSON.parse(planForm.featuresJson) as Record<string, unknown>;
      } catch {
        throw new ApiError(t("superAdmin.billingInvalidJson"), 400);
      }

      const payload = {
        slug: planForm.slug.trim(),
        name: planForm.name.trim(),
        description: planForm.description.trim() || null,
        currency: planForm.currency.trim(),
        amountCents: Number(planForm.amountCents),
        interval: planForm.interval as "month" | "year",
        trialDays: planForm.trialDays.trim() ? Number(planForm.trialDays) : null,
        displayOrder: Number(planForm.displayOrder) || 0,
        isActive: planForm.isActive,
        stripeProductId: planForm.stripeProductId.trim() || null,
        stripePriceId: planForm.stripePriceId.trim() || null,
        legacyPlanTier: planForm.legacyPlanTier.trim()
          ? (planForm.legacyPlanTier as "free" | "growth" | "enterprise")
          : null,
        limits,
        features,
      };

      if (editingPlan) {
        await api.patch(`/super/billing/plans/${editingPlan.id}`, payload);
      } else {
        await api.post("/super/billing/plans", payload);
      }
      setPlanModalOpen(false);
      await loadPlans();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setPlanSaving(false);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setError("");
    try {
      await api.patch("/super/billing/settings", {
        gracePeriodDays: Number(gracePeriodDays),
      });
      await loadSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SuperAdminPageHeader
        title={t("superAdmin.billingSectionTitle")}
        subtitle={t("superAdmin.billingSectionSubtitle")}
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(["plans", "subscriptions", "settings"] as const).map((id) => (
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
            {t(`superAdmin.billingTab_${id}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      {tab === "plans" && !loading ? (
        <SuperAdminPanel className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <CreditCard className="h-4 w-4" />
              {t("superAdmin.billingPlansTitle")}
            </div>
            <button type="button" onClick={openCreatePlan} className="btn-primary inline-flex items-center gap-1.5 text-sm">
              <Plus className="h-4 w-4" />
              {t("superAdmin.billingPlanCreate")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("superAdmin.billingColPlan")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPrice")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStripe")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStatus")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColSubs")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{plan.name}</div>
                      <div className="text-xs text-slate-500">{plan.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      {formatMoney(plan.amountCents, plan.currency, localeTag)} / {plan.interval}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{plan.stripeProductId || "—"}</div>
                      <div className="text-slate-400">{plan.stripePriceId || "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          plan.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {plan.isActive ? t("superAdmin.billingActive") : t("superAdmin.billingInactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3">{plan.subscriptionCount}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditPlan(plan)}
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

      {tab === "subscriptions" && !loading ? (
        <SuperAdminPanel className="overflow-hidden p-0">
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.billingSearchOrg")}</label>
              <input
                value={subQuery}
                onChange={(e) => setSubQuery(e.target.value)}
                className="input-field mt-1 w-56"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.billingFilterStatus")}</label>
              <select value={subStatus} onChange={(e) => setSubStatus(e.target.value)} className="input-field mt-1">
                <option value="">{t("superAdmin.billingAllStatuses")}</option>
                <option value="active">active</option>
                <option value="trialing">trialing</option>
                <option value="past_due">past_due</option>
                <option value="canceled">canceled</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void loadSubscriptions()}>
              {t("common.search")}
            </button>
            <span className="ml-auto text-xs text-slate-500">
              {t("superAdmin.billingSubTotal").replace("{count}", String(subTotal))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("superAdmin.billingColOrganization")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPlan")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStatus")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColRenewal")}</th>
                  <th className="px-4 py-3">Stripe Sub</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{sub.organization.name}</div>
                      <div className="text-xs text-slate-500">{sub.organization.slug}</div>
                    </td>
                    <td className="px-4 py-3">{sub.plan?.name ?? sub.organization.planTier}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{sub.status}</span>
                      {sub.cancelAtPeriodEnd ? (
                        <span className="ml-2 text-xs text-amber-700">{t("superAdmin.billingCancelScheduled")}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{formatDate(sub.currentPeriodEnd, localeTag)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{sub.stripeSubscriptionId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SuperAdminPanel>
      ) : null}

      {tab === "settings" && !loading ? (
        <SuperAdminPanel className="p-4">
          <form onSubmit={(e) => void saveSettings(e)} className="max-w-md space-y-4">
            <h3 className="text-base font-semibold text-slate-900">{t("superAdmin.billingSettingsTitle")}</h3>
            <p className="text-sm text-slate-600">{t("superAdmin.billingSettingsHint")}</p>
            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.billingGraceDays")}</label>
              <input
                type="number"
                min={0}
                max={90}
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(e.target.value)}
                className="input-field mt-1 w-32"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={settingsSaving}>
              {settingsSaving ? t("common.saving") : t("common.save")}
            </button>
          </form>
        </SuperAdminPanel>
      ) : null}

      {planModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-h-[90vh] w-full max-w-2xl overflow-auto p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900">
              {editingPlan ? t("superAdmin.billingEditPlan") : t("superAdmin.billingPlanCreate")}
            </h3>
            <form onSubmit={(e) => void submitPlan(e)} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-ink-600">Slug</label>
                <input
                  value={planForm.slug}
                  onChange={(e) => setPlanForm((f) => ({ ...f, slug: e.target.value }))}
                  className="input-field mt-1"
                  required
                  disabled={Boolean(editingPlan)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPlan")}</label>
                <input
                  value={planForm.name}
                  onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-field mt-1"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingDescription")}</label>
                <textarea
                  value={planForm.description}
                  onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                  className="input-field mt-1 min-h-[72px]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPrice")}</label>
                <input
                  type="number"
                  min={0}
                  value={planForm.amountCents}
                  onChange={(e) => setPlanForm((f) => ({ ...f, amountCents: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">Currency</label>
                <input
                  value={planForm.currency}
                  onChange={(e) => setPlanForm((f) => ({ ...f, currency: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">Stripe Product ID</label>
                <input
                  value={planForm.stripeProductId}
                  onChange={(e) => setPlanForm((f) => ({ ...f, stripeProductId: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">Stripe Price ID</label>
                <input
                  value={planForm.stripePriceId}
                  onChange={(e) => setPlanForm((f) => ({ ...f, stripePriceId: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.planColumn")}</label>
                <select
                  value={planForm.legacyPlanTier}
                  onChange={(e) => setPlanForm((f) => ({ ...f, legacyPlanTier: e.target.value }))}
                  className="input-field mt-1"
                >
                  <option value="">—</option>
                  <option value="free">{t("superAdmin.planFree")}</option>
                  <option value="growth">{t("superAdmin.planGrowth")}</option>
                  <option value="enterprise">{t("superAdmin.planEnterprise")}</option>
                </select>
              </div>
              <div>
                <label className="flex cursor-pointer items-center gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    checked={planForm.isActive}
                    onChange={(e) => setPlanForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  {t("superAdmin.billingActive")}
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">limits (JSON)</label>
                <textarea
                  value={planForm.limitsJson}
                  onChange={(e) => setPlanForm((f) => ({ ...f, limitsJson: e.target.value }))}
                  className="input-field mt-1 min-h-[120px] font-mono text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">features (JSON)</label>
                <textarea
                  value={planForm.featuresJson}
                  onChange={(e) => setPlanForm((f) => ({ ...f, featuresJson: e.target.value }))}
                  className="input-field mt-1 min-h-[100px] font-mono text-xs"
                />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setPlanModalOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={planSaving}>
                  {planSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
