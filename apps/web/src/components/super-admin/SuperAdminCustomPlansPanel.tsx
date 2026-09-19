import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";
import { MoneyCentsInput } from "@/components/billing/MoneyCentsInput";
import { PlanLimitsFeaturesEditor } from "@/components/super-admin/PlanLimitsFeaturesEditor";
import {
  PlanBillingProvidersEditor,
  type PlanPaymentProvidersForm,
} from "@/components/super-admin/PlanBillingProvidersEditor";
import { parseSuperAdminOrgList, type SuperAdminOrgOption } from "@/lib/superAdminOrganizations";

type CustomPlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  badgeLabel?: string | null;
  amountCents: number;
  currency: string;
  interval: string;
  paymentGraceDays: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  mercadopagoPlanId: string | null;
  legacyPlanTier: string | null;
  isActive: boolean;
  organization: { id: string; name: string; slug: string } | null;
  limits: Record<string, number | null | undefined>;
  features: Record<string, boolean | undefined>;
  planExtras?: Record<string, string | undefined>;
  paymentProviders?: PlanPaymentProvidersForm;
};

type CustomPlanForm = {
  organizationId: string;
  name: string;
  description: string;
  badgeLabel: string;
  currency: string;
  amountCents: string;
  interval: string;
  paymentGraceDays: string;
  stripeProductId: string;
  stripePriceId: string;
  mercadopagoPlanId: string;
  legacyPlanTier: string;
  isActive: boolean;
  paymentProviders: PlanPaymentProvidersForm;
  limitsJson: string;
  featuresJson: string;
  extrasJson: string;
};

const EMPTY_CUSTOM_FORM: CustomPlanForm = {
  organizationId: "",
  name: "",
  description: "",
  badgeLabel: "",
  currency: "BRL",
  amountCents: "9900",
  interval: "month",
  paymentGraceDays: "7",
  stripeProductId: "",
  stripePriceId: "",
  mercadopagoPlanId: "",
  legacyPlanTier: "",
  isActive: true,
  paymentProviders: { stripe: true, mercadopago: true },
  limitsJson: '{\n  "agents": 10,\n  "automations": 50,\n  "contacts": 10000,\n  "messages": 50000\n}',
  featuresJson: '{\n  "rag": true,\n  "api": true,\n  "mcp": false\n}',
  extrasJson: "{}",
};

function formatMoney(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function planToForm(plan: CustomPlanRow): CustomPlanForm {
  return {
    organizationId: plan.organization?.id ?? "",
    name: plan.name,
    description: plan.description ?? "",
    badgeLabel: plan.badgeLabel ?? "",
    currency: plan.currency,
    amountCents: String(plan.amountCents),
    interval: plan.interval,
    paymentGraceDays: plan.paymentGraceDays != null ? String(plan.paymentGraceDays) : "7",
    stripeProductId: plan.stripeProductId ?? "",
    stripePriceId: plan.stripePriceId ?? "",
    mercadopagoPlanId: plan.mercadopagoPlanId ?? "",
    legacyPlanTier: plan.legacyPlanTier ?? "",
    isActive: plan.isActive,
    paymentProviders: plan.paymentProviders ?? { stripe: true, mercadopago: true },
    limitsJson: JSON.stringify(plan.limits, null, 2),
    featuresJson: JSON.stringify(plan.features, null, 2),
    extrasJson: JSON.stringify(plan.planExtras ?? {}, null, 2),
  };
}

export function SuperAdminCustomPlansPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<CustomPlanRow[]>([]);
  const [orgs, setOrgs] = useState<SuperAdminOrgOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CustomPlanRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState<CustomPlanForm>(EMPTY_CUSTOM_FORM);
  const [mercadoPagoPlatformConfigured, setMercadoPagoPlatformConfigured] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [planRes, orgRaw, settingsRes] = await Promise.all([
        api.get<{ plans: CustomPlanRow[] }>("/super/billing/custom-plans"),
        api.get<unknown>("/super/organizations"),
        api.get<{ mercadoPagoPlatformConfigured?: boolean }>("/super/billing/settings"),
      ]);
      setPlans(Array.isArray(planRes.plans) ? planRes.plans : []);
      setOrgs(parseSuperAdminOrgList(orgRaw));
      setMercadoPagoPlatformConfigured(settingsRes.mercadoPagoPlatformConfigured === true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingPlan(null);
    setForm(EMPTY_CUSTOM_FORM);
    setModalOpen(true);
  };

  const openEdit = (plan: CustomPlanRow) => {
    setEditingPlan(plan);
    setForm(planToForm(plan));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingPlan(null);
    setForm(EMPTY_CUSTOM_FORM);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingPlan && !form.organizationId) return;
    setSaving(true);
    setError("");
    try {
      let limits: Record<string, unknown> = {};
      let features: Record<string, unknown> = {};
      let planExtras: Record<string, unknown> = {};
      try {
        limits = JSON.parse(form.limitsJson) as Record<string, unknown>;
        features = JSON.parse(form.featuresJson) as Record<string, unknown>;
        planExtras = JSON.parse(form.extrasJson) as Record<string, unknown>;
      } catch {
        throw new ApiError(t("superAdmin.billingInvalidJson"), 400);
      }

      const amountCents = Number(form.amountCents);
      if (amountCents > 0 && !form.paymentProviders.stripe && !form.paymentProviders.mercadopago) {
        throw new ApiError(t("superAdmin.billingPlanProvidersRequired"), 400);
      }

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        badgeLabel: form.badgeLabel.trim() || null,
        currency: form.currency.trim(),
        amountCents,
        interval: form.interval,
        paymentGraceDays: Number(form.paymentGraceDays),
        stripeProductId: form.paymentProviders.stripe ? form.stripeProductId.trim() || null : null,
        stripePriceId: form.paymentProviders.stripe ? form.stripePriceId.trim() || null : null,
        mercadopagoPlanId: form.paymentProviders.mercadopago ? form.mercadopagoPlanId.trim() || null : null,
        paymentProviders: form.paymentProviders,
        legacyPlanTier: form.legacyPlanTier.trim()
          ? (form.legacyPlanTier as "free" | "growth" | "enterprise")
          : null,
        limits,
        features,
        planExtras,
        isActive: form.isActive,
      };

      if (editingPlan) {
        const res = await api.patch<{ plan: CustomPlanRow }>(`/super/billing/custom-plans/${editingPlan.id}`, payload);
        setPlans((rows) => rows.map((row) => (row.id === editingPlan.id ? res.plan : row)));
      } else {
        await api.post("/super/billing/custom-plans", {
          organizationId: form.organizationId,
          ...payload,
        });
        await load();
      }
      closeModal();
      setSuccess(t("superAdmin.billingCustomPlanSaved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const generateMercadoPagoPlanId = async () => {
    if (!editingPlan) return;
    setSyncingPlanId(editingPlan.id);
    setError("");
    try {
      const res = await api.post<{ sync: { mercadopagoPlanId: string }; plan: CustomPlanRow | null }>(
        `/super/billing/custom-plans/${editingPlan.id}/sync-mercadopago`,
        {},
      );
      const nextId = res.sync.mercadopagoPlanId;
      setForm((f) => ({ ...f, mercadopagoPlanId: nextId }));
      if (res.plan) {
        setEditingPlan(res.plan);
        setPlans((rows) => rows.map((row) => (row.id === editingPlan.id ? res.plan! : row)));
      }
      setSuccess(t("superAdmin.billingSyncMercadoPagoSuccess").replace("{id}", nextId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSyncMercadoPagoError"));
    } finally {
      setSyncingPlanId(null);
    }
  };

  const deletePlan = async (plan: CustomPlanRow) => {
    if (!window.confirm(t("superAdmin.billingCustomPlanDeleteConfirm").replace("{name}", plan.name))) return;
    setDeletingPlanId(plan.id);
    setError("");
    setSuccess("");
    try {
      await api.delete(`/super/billing/custom-plans/${plan.id}`);
      setPlans((rows) => rows.filter((row) => row.id !== plan.id));
      setSuccess(t("superAdmin.billingCustomPlanDeleted"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingCustomPlanDeleteError"));
    } finally {
      setDeletingPlanId(null);
    }
  };

  const syncPlanToMercadoPago = async (plan: CustomPlanRow) => {
    setSyncingPlanId(plan.id);
    setError("");
    setSuccess("");
    try {
      const res = await api.post<{ sync: { mercadopagoPlanId: string }; plan: CustomPlanRow | null }>(
        `/super/billing/custom-plans/${plan.id}/sync-mercadopago`,
        {},
      );
      if (res.plan) {
        setPlans((rows) => rows.map((row) => (row.id === plan.id ? res.plan! : row)));
      } else {
        await load();
      }
      setSuccess(t("superAdmin.billingSyncMercadoPagoSuccess").replace("{id}", res.sync.mercadopagoPlanId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSyncMercadoPagoError"));
    } finally {
      setSyncingPlanId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>
      ) : null}

      <SuperAdminPanel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <Sparkles className="h-4 w-4" />
            {t("superAdmin.billingCustomPlansTitle")}
          </div>
          <button type="button" onClick={openCreate} className="btn-primary inline-flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" />
            {t("superAdmin.billingCustomPlanCreate")}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("superAdmin.billingColOrganization")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPlan")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColPrice")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColGraceDays")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStripe")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColMercadoPago")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingColStatus")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      {t("superAdmin.billingCustomPlansEmpty")}
                    </td>
                  </tr>
                ) : (
                  plans.map((plan) => (
                    <tr key={plan.id} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{plan.organization?.name ?? "—"}</div>
                        <div className="text-xs text-slate-500">{plan.organization?.slug}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{plan.name}</div>
                        <div className="text-xs text-slate-500">{plan.slug}</div>
                      </td>
                      <td className="px-4 py-3">
                        {formatMoney(plan.amountCents, plan.currency, localeTag)} / {plan.interval}
                      </td>
                      <td className="px-4 py-3">{plan.paymentGraceDays ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{plan.stripePriceId || "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{plan.mercadopagoPlanId || "—"}</td>
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
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {plan.amountCents > 0 ? (
                            <button
                              type="button"
                              disabled={syncingPlanId === plan.id}
                              onClick={() => void syncPlanToMercadoPago(plan)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                            >
                              {syncingPlanId === plan.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              {t("superAdmin.billingSyncMercadoPago")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openEdit(plan)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t("superAdmin.billingEditPlan")}
                          </button>
                          <button
                            type="button"
                            disabled={deletingPlanId === plan.id}
                            onClick={() => void deletePlan(plan)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                          >
                            {deletingPlanId === plan.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            {t("superAdmin.billingCustomPlanDelete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SuperAdminPanel>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-h-[90vh] w-full max-w-3xl overflow-auto p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900">
              {editingPlan ? t("superAdmin.billingCustomPlanEdit") : t("superAdmin.billingCustomPlanCreate")}
            </h3>
            <p className="mt-1 text-sm text-ink-500">
              {editingPlan ? t("superAdmin.billingCustomPlanEditIntro") : t("superAdmin.billingCustomPlanIntro")}
            </p>
            <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColOrganization")}</label>
                {editingPlan ? (
                  <div className="input-field mt-1 bg-slate-50 text-sm text-ink-700">
                    {editingPlan.organization?.name ?? "—"}
                    {editingPlan.organization?.slug ? ` (${editingPlan.organization.slug})` : ""}
                  </div>
                ) : (
                  <select
                    value={form.organizationId}
                    onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}
                    className="input-field mt-1"
                    required
                  >
                    <option value="">{t("superAdmin.billingSelectOrganization")}</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}{o.slug ? ` (${o.slug})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPlan")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-field mt-1"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingDescription")}</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="input-field mt-1 min-h-[72px]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingBadgeLabel")}</label>
                <input
                  value={form.badgeLabel}
                  onChange={(e) => setForm((f) => ({ ...f, badgeLabel: e.target.value }))}
                  className="input-field mt-1"
                  placeholder={t("superAdmin.billingBadgeLabelPlaceholder")}
                  maxLength={80}
                />
                <p className="mt-1 text-xs text-ink-500">{t("superAdmin.billingBadgeLabelHint")}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPrice")}</label>
                <MoneyCentsInput
                  className="mt-1"
                  currency={form.currency || "BRL"}
                  valueCents={form.amountCents}
                  onChangeCents={(amountCents) => setForm((f) => ({ ...f, amountCents }))}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColGraceDays")}</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={form.paymentGraceDays}
                  onChange={(e) => setForm((f) => ({ ...f, paymentGraceDays: e.target.value }))}
                  className="input-field mt-1"
                  required
                />
              </div>
              <PlanBillingProvidersEditor
                amountCents={Number(form.amountCents) || 0}
                providers={form.paymentProviders}
                onProvidersChange={(paymentProviders) => setForm((f) => ({ ...f, paymentProviders }))}
                stripeProductId={form.stripeProductId}
                stripePriceId={form.stripePriceId}
                onStripeProductIdChange={(stripeProductId) => setForm((f) => ({ ...f, stripeProductId }))}
                onStripePriceIdChange={(stripePriceId) => setForm((f) => ({ ...f, stripePriceId }))}
                mercadopagoPlanId={form.mercadopagoPlanId}
                onMercadopagoPlanIdChange={(mercadopagoPlanId) => setForm((f) => ({ ...f, mercadopagoPlanId }))}
                planId={editingPlan?.id}
                mercadoPagoPlatformConfigured={mercadoPagoPlatformConfigured}
                generatingMercadoPago={syncingPlanId === editingPlan?.id}
                onGenerateMercadoPago={generateMercadoPagoPlanId}
              />
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.planColumn")}</label>
                <select
                  value={form.legacyPlanTier}
                  onChange={(e) => setForm((f) => ({ ...f, legacyPlanTier: e.target.value }))}
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
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  {t("superAdmin.billingActive")}
                </label>
              </div>
              <PlanLimitsFeaturesEditor
                limitsJson={form.limitsJson}
                featuresJson={form.featuresJson}
                extrasJson={form.extrasJson}
                onLimitsJsonChange={(limitsJson) => setForm((f) => ({ ...f, limitsJson }))}
                onFeaturesJsonChange={(featuresJson) => setForm((f) => ({ ...f, featuresJson }))}
                onExtrasJsonChange={(extrasJson) => setForm((f) => ({ ...f, extrasJson }))}
              />
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={closeModal}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving
                    ? t("common.saving")
                    : editingPlan
                      ? t("common.save")
                      : t("superAdmin.billingCustomPlanAssign")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
