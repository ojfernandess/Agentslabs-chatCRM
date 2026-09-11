import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";
import { PlanLimitsFeaturesEditor } from "@/components/super-admin/PlanLimitsFeaturesEditor";
import { parseSuperAdminOrgList, type SuperAdminOrgOption } from "@/lib/superAdminOrganizations";

type CustomPlanRow = {
  id: string;
  slug: string;
  name: string;
  amountCents: number;
  currency: string;
  interval: string;
  paymentGraceDays: number | null;
  stripePriceId: string | null;
  isActive: boolean;
  organization: { id: string; name: string; slug: string } | null;
  limits: Record<string, number | null | undefined>;
};

const EMPTY_CUSTOM_FORM = {
  organizationId: "",
  name: "",
  description: "",
  currency: "BRL",
  amountCents: "9900",
  interval: "month",
  paymentGraceDays: "7",
  stripeProductId: "",
  stripePriceId: "",
  legacyPlanTier: "",
  limitsJson: '{\n  "agents": 10,\n  "automations": 50,\n  "contacts": 10000,\n  "messages": 50000\n}',
  featuresJson: '{\n  "rag": true,\n  "api": true,\n  "mcp": false\n}',
};

function formatMoney(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function SuperAdminCustomPlansPanel() {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<CustomPlanRow[]>([]);
  const [orgs, setOrgs] = useState<SuperAdminOrgOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_CUSTOM_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [planRes, orgRaw] = await Promise.all([
        api.get<{ plans: CustomPlanRow[] }>("/super/billing/custom-plans"),
        api.get<unknown>("/super/organizations"),
      ]);
      setPlans(Array.isArray(planRes.plans) ? planRes.plans : []);
      setOrgs(parseSuperAdminOrgList(orgRaw));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.organizationId) return;
    setSaving(true);
    setError("");
    try {
      let limits: Record<string, unknown> = {};
      let features: Record<string, unknown> = {};
      try {
        limits = JSON.parse(form.limitsJson) as Record<string, unknown>;
        features = JSON.parse(form.featuresJson) as Record<string, unknown>;
      } catch {
        throw new ApiError(t("superAdmin.billingInvalidJson"), 400);
      }

      await api.post("/super/billing/custom-plans", {
        organizationId: form.organizationId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        currency: form.currency.trim(),
        amountCents: Number(form.amountCents),
        interval: form.interval,
        paymentGraceDays: Number(form.paymentGraceDays),
        stripeProductId: form.stripeProductId.trim() || null,
        stripePriceId: form.stripePriceId.trim() || null,
        legacyPlanTier: form.legacyPlanTier.trim()
          ? (form.legacyPlanTier as "free" | "growth" | "enterprise")
          : null,
        limits,
        features,
      });
      setModalOpen(false);
      setForm(EMPTY_CUSTOM_FORM);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <SuperAdminPanel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <Sparkles className="h-4 w-4" />
            {t("superAdmin.billingCustomPlansTitle")}
          </div>
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_CUSTOM_FORM);
              setModalOpen(true);
            }}
            className="btn-primary inline-flex items-center gap-1.5 text-sm"
          >
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
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
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
            <h3 className="text-lg font-semibold text-ink-900">{t("superAdmin.billingCustomPlanCreate")}</h3>
            <p className="mt-1 text-sm text-ink-500">{t("superAdmin.billingCustomPlanIntro")}</p>
            <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColOrganization")}</label>
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
              <div>
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingColPrice")}</label>
                <input
                  type="number"
                  min={0}
                  value={form.amountCents}
                  onChange={(e) => setForm((f) => ({ ...f, amountCents: e.target.value }))}
                  className="input-field mt-1"
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
              <div>
                <label className="block text-xs font-medium text-ink-600">Stripe Product ID</label>
                <input
                  value={form.stripeProductId}
                  onChange={(e) => setForm((f) => ({ ...f, stripeProductId: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600">Stripe Price ID</label>
                <input
                  value={form.stripePriceId}
                  onChange={(e) => setForm((f) => ({ ...f, stripePriceId: e.target.value }))}
                  className="input-field mt-1"
                />
              </div>
              <PlanLimitsFeaturesEditor
                limitsJson={form.limitsJson}
                featuresJson={form.featuresJson}
                onLimitsJsonChange={(limitsJson) => setForm((f) => ({ ...f, limitsJson }))}
                onFeaturesJsonChange={(featuresJson) => setForm((f) => ({ ...f, featuresJson }))}
              />
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? t("common.saving") : t("superAdmin.billingCustomPlanAssign")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
