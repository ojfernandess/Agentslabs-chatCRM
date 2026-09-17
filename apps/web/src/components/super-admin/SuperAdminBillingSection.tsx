import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CreditCard, Loader2, Mail, Pencil, Plus, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPageHeader, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";
import { SuperAdminCustomPlansPanel } from "@/components/super-admin/SuperAdminCustomPlansPanel";
import { SuperAdminPaymentProvidersPanel } from "@/components/super-admin/SuperAdminPaymentProvidersPanel";
import { MoneyCentsInput } from "@/components/billing/MoneyCentsInput";
import { PlanLimitsFeaturesEditor } from "@/components/super-admin/PlanLimitsFeaturesEditor";
import { translateBillingStatus } from "@/lib/billingStatusLabels";
import {
  ALL_CATALOG_LIMIT_KEYS,
  PLAN_LIMITS_ENABLED_KEY,
  catalogLimitLabelKey,
  orderPlanLimitKeys,
} from "@/lib/planCatalog";

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
  mercadopagoPlanId: string | null;
  legacyPlanTier: string | null;
  limits: Record<string, number | null | undefined>;
  features: Record<string, boolean | undefined>;
  planExtras?: Record<string, string | undefined>;
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
  paymentDueAt: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};

type ReminderModalState = {
  organizationId: string;
  organizationName: string;
  billingEmail: string;
};

type BillingTab = "providers" | "plans" | "customPlans" | "subscriptions" | "settings";

type DimensionOverageForm = {
  enabled: boolean;
  stripeMeterEventName: string;
  unitAmountCents: string;
};

type BillingPlatformSettings = {
  gracePeriodDays: number;
  limitEnforcementMode: "block" | "overage";
  overage: Record<string, DimensionOverageForm>;
};

function defaultMeterEventName(key: string): string {
  const safe = key.replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_");
  return `openconduit_${safe}_overage`;
}

function emptyOverageDimension(key: string): DimensionOverageForm {
  return {
    enabled: false,
    stripeMeterEventName: defaultMeterEventName(key),
    unitAmountCents: "",
  };
}

function emptyOverageForm(keys: Iterable<string> = ALL_CATALOG_LIMIT_KEYS): Record<string, DimensionOverageForm> {
  const out: Record<string, DimensionOverageForm> = {};
  for (const key of keys) {
    out[key] = emptyOverageDimension(key);
  }
  return out;
}

function collectLimitKeysFromPlans(planRows: PlanRow[]): string[] {
  const keys = new Set<string>();
  for (const plan of planRows) {
    for (const key of Object.keys(plan.limits ?? {})) {
      if (key !== PLAN_LIMITS_ENABLED_KEY) keys.add(key);
    }
  }
  return [...keys];
}

function buildOverageLimitKeys(standardPlans: PlanRow[], customPlanRows: PlanRow[]): string[] {
  return orderPlanLimitKeys([
    ...ALL_CATALOG_LIMIT_KEYS,
    ...collectLimitKeysFromPlans(standardPlans),
    ...collectLimitKeysFromPlans(customPlanRows),
  ]);
}

function settingsFromApi(
  raw: {
    gracePeriodDays: number;
    limitEnforcementMode?: "block" | "overage";
    overage?: Partial<
      Record<string, { enabled?: boolean; stripeMeterEventName?: string | null; unitAmountCents?: number | null }>
    >;
  },
  limitKeys: string[],
): BillingPlatformSettings {
  const overage = emptyOverageForm(limitKeys);
  for (const key of limitKeys) {
    const dim = raw.overage?.[key];
    if (!dim) continue;
    overage[key] = {
      enabled: dim.enabled === true,
      stripeMeterEventName: dim.stripeMeterEventName?.trim() || defaultMeterEventName(key),
      unitAmountCents: dim.unitAmountCents != null ? String(dim.unitAmountCents) : "",
    };
  }
  for (const [key, dim] of Object.entries(raw.overage ?? {})) {
    if (key in overage || !dim) continue;
    overage[key] = {
      enabled: dim.enabled === true,
      stripeMeterEventName: dim.stripeMeterEventName?.trim() || defaultMeterEventName(key),
      unitAmountCents: dim.unitAmountCents != null ? String(dim.unitAmountCents) : "",
    };
  }
  return {
    gracePeriodDays: raw.gracePeriodDays,
    limitEnforcementMode: raw.limitEnforcementMode === "overage" ? "overage" : "block",
    overage,
  };
}

function overageLimitLabel(t: (key: string) => string, key: string): string {
  const labelKey = catalogLimitLabelKey(key);
  if (labelKey) {
    const translated = t(labelKey);
    if (translated !== labelKey) return translated;
  }
  return key.replace(/_/g, " ");
}

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
  mercadopagoPlanId: "",
  legacyPlanTier: "",
  limitsJson: '{\n  "agents": 3,\n  "automations": 10,\n  "contacts": 1000,\n  "messages": null\n}',
  featuresJson: '{\n  "rag": false,\n  "api": false,\n  "mcp": false\n}',
  extrasJson: "{}",
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
  const [tab, setTab] = useState<BillingTab>("providers");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subTotal, setSubTotal] = useState(0);
  const [subQuery, setSubQuery] = useState("");
  const [subStatus, setSubStatus] = useState("");
  const [customPlans, setCustomPlans] = useState<PlanRow[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingPlatformSettings>(() => ({
    gracePeriodDays: 7,
    limitEnforcementMode: "block",
    overage: emptyOverageForm(),
  }));

  const overageLimitKeys = useMemo(() => {
    const keys = new Set<string>(ALL_CATALOG_LIMIT_KEYS);
    for (const key of collectLimitKeysFromPlans(plans)) keys.add(key);
    for (const key of collectLimitKeysFromPlans(customPlans)) keys.add(key);
    for (const key of Object.keys(billingSettings.overage)) keys.add(key);
    return orderPlanLimitKeys(keys);
  }, [plans, customPlans, billingSettings.overage]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [stripeKeyMode, setStripeKeyMode] = useState<"test" | "live" | "unknown">("unknown");
  const [mercadoPagoPlatformConfigured, setMercadoPagoPlatformConfigured] = useState(false);
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null);
  const [resetClearPlanIds, setResetClearPlanIds] = useState(true);
  const [resetBusy, setResetBusy] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN_FORM);
  const [planSaving, setPlanSaving] = useState(false);
  const [billingEmailDrafts, setBillingEmailDrafts] = useState<Record<string, string>>({});
  const [billingEmailSaving, setBillingEmailSaving] = useState<string | null>(null);
  const [reminderModal, setReminderModal] = useState<ReminderModalState | null>(null);
  const [reminderSending, setReminderSending] = useState(false);
  const [billingSuccess, setBillingSuccess] = useState("");

  const loadPlans = useCallback(async () => {
    const res = await api.get<{ plans: PlanRow[] }>("/super/billing/plans");
    setPlans(res.plans);
    return res.plans;
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

  const loadSettings = useCallback(async (limitKeys: string[]) => {
    const res = await api.get<{
      settings: Parameters<typeof settingsFromApi>[0];
      stripeKeyMode?: "test" | "live" | "unknown";
      mercadoPagoPlatformConfigured?: boolean;
    }>("/super/billing/settings");
    setBillingSettings(settingsFromApi(res.settings, limitKeys));
    setStripeKeyMode(res.stripeKeyMode ?? "unknown");
    setMercadoPagoPlatformConfigured(res.mercadoPagoPlatformConfigured === true);
  }, []);

  const loadCustomPlans = useCallback(async () => {
    const res = await api.get<{ plans: PlanRow[] }>("/super/billing/custom-plans");
    setCustomPlans(res.plans);
    return res.plans;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [standardPlans, loadedCustomPlans] = await Promise.all([
        loadPlans(),
        loadCustomPlans(),
        loadSubscriptions(),
      ]);
      await loadSettings(buildOverageLimitKeys(standardPlans, loadedCustomPlans));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("superAdmin.billingLoadError"));
    } finally {
      setLoading(false);
    }
  }, [loadPlans, loadCustomPlans, loadSubscriptions, loadSettings, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab !== "subscriptions") return;
    void loadSubscriptions().catch(() => {});
  }, [tab, loadSubscriptions]);

  useEffect(() => {
    setBillingSettings((s) => {
      let changed = false;
      const nextOverage = { ...s.overage };
      for (const key of overageLimitKeys) {
        if (!(key in nextOverage)) {
          nextOverage[key] = emptyOverageDimension(key);
          changed = true;
        }
      }
      return changed ? { ...s, overage: nextOverage } : s;
    });
  }, [overageLimitKeys]);

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
      mercadopagoPlanId: plan.mercadopagoPlanId ?? "",
      legacyPlanTier: plan.legacyPlanTier ?? "",
      limitsJson: JSON.stringify(plan.limits, null, 2),
      featuresJson: JSON.stringify(plan.features, null, 2),
      extrasJson: JSON.stringify(plan.planExtras ?? {}, null, 2),
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
      let planExtras: Record<string, unknown> = {};
      try {
        limits = JSON.parse(planForm.limitsJson) as Record<string, unknown>;
        features = JSON.parse(planForm.featuresJson) as Record<string, unknown>;
        planExtras = JSON.parse(planForm.extrasJson) as Record<string, unknown>;
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
        mercadopagoPlanId: planForm.mercadopagoPlanId.trim() || null,
        legacyPlanTier: planForm.legacyPlanTier.trim()
          ? (planForm.legacyPlanTier as "free" | "growth" | "enterprise")
          : null,
        limits,
        features,
        planExtras,
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

  const syncPlanToMercadoPago = async (plan: PlanRow) => {
    setSyncingPlanId(plan.id);
    setError("");
    setBillingSuccess("");
    try {
      const res = await api.post<{ sync: { mercadopagoPlanId: string; created: boolean }; plan: PlanRow | null }>(
        `/super/billing/plans/${plan.id}/sync-mercadopago`,
        {},
      );
      if (res.plan) {
        setPlans((rows) => rows.map((row) => (row.id === plan.id ? res.plan! : row)));
      } else {
        await loadPlans();
      }
      setBillingSuccess(
        t("superAdmin.billingSyncMercadoPagoSuccess").replace("{id}", res.sync.mercadopagoPlanId),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSyncMercadoPagoError"));
    } finally {
      setSyncingPlanId(null);
    }
  };

  const resetStripeBindings = async () => {
    if (
      !window.confirm(
        resetClearPlanIds
          ? t("superAdmin.billingResetStripeConfirmWithPlans")
          : t("superAdmin.billingResetStripeConfirm"),
      )
    ) {
      return;
    }
    setResetBusy(true);
    setError("");
    try {
      const res = await api.post<{
        organizationsCleared: number;
        subscriptionsCleared: number;
        plansCleared: number;
      }>("/super/billing/reset-stripe-bindings", { clearPlanStripeIds: resetClearPlanIds });
      await loadSettings(buildOverageLimitKeys(plans, customPlans));
      window.alert(
        t("superAdmin.billingResetStripeDone")
          .replace("{orgs}", String(res.organizationsCleared))
          .replace("{subs}", String(res.subscriptionsCleared))
          .replace("{plans}", String(res.plansCleared)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setResetBusy(false);
    }
  };

  const billingEmailValue = (sub: SubscriptionRow): string =>
    billingEmailDrafts[sub.organizationId] ?? sub.organization.billingEmail ?? "";

  const saveBillingEmail = async (organizationId: string) => {
    const value = billingEmailDrafts[organizationId]?.trim() ?? "";
    setBillingEmailSaving(organizationId);
    setError("");
    setBillingSuccess("");
    try {
      await api.patch(`/super/billing/organizations/${organizationId}/billing-email`, {
        billingEmail: value,
      });
      setSubscriptions((rows) =>
        rows.map((row) =>
          row.organizationId === organizationId
            ? {
                ...row,
                organization: { ...row.organization, billingEmail: value || null },
              }
            : row,
        ),
      );
      setBillingSuccess(t("superAdmin.billingEmailSaved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setBillingEmailSaving(null);
    }
  };

  const openReminderModal = (sub: SubscriptionRow) => {
    setReminderModal({
      organizationId: sub.organizationId,
      organizationName: sub.organization.name,
      billingEmail: billingEmailValue(sub),
    });
  };

  const sendPaymentReminder = async () => {
    if (!reminderModal) return;
    setReminderSending(true);
    setError("");
    setBillingSuccess("");
    try {
      const body: { billingEmail?: string } = {};
      const email = reminderModal.billingEmail.trim();
      if (email) body.billingEmail = email;
      const res = await api.post<{ ok: true; sentTo: string }>(
        `/super/billing/subscriptions/${reminderModal.organizationId}/send-payment-reminder`,
        body,
      );
      setBillingSuccess(t("superAdmin.billingReminderSent").replace("{email}", res.sentTo));
      setReminderModal(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingReminderError"));
    } finally {
      setReminderSending(false);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setError("");
    try {
      const overagePayload: Partial<
        Record<string, { enabled: boolean; stripeMeterEventName: string | null; unitAmountCents: number | null }>
      > = {};
      for (const key of overageLimitKeys) {
        const dim = billingSettings.overage[key] ?? emptyOverageDimension(key);
        overagePayload[key] = {
          enabled: dim.enabled,
          stripeMeterEventName: dim.stripeMeterEventName.trim() || null,
          unitAmountCents: dim.unitAmountCents.trim() ? Number(dim.unitAmountCents) : null,
        };
      }
      await api.patch("/super/billing/settings", {
        gracePeriodDays: billingSettings.gracePeriodDays,
        limitEnforcementMode: billingSettings.limitEnforcementMode,
        overage: overagePayload,
      });
      await loadSettings(overageLimitKeys);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.billingSaveError"));
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SuperAdminPageHeader
        title={
          tab === "providers"
            ? t("superAdmin.billingProvidersTitle")
            : t("superAdmin.billingSectionTitle")
        }
        subtitle={
          tab === "providers"
            ? t("superAdmin.billingProvidersSubtitle")
            : t("superAdmin.billingSectionSubtitle")
        }
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {billingSuccess ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {billingSuccess}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(["providers", "plans", "customPlans", "subscriptions", "settings"] as const).map((id) => (
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

      {tab === "providers" && !loading ? (
        <SuperAdminPaymentProvidersPanel
          stripeKeyMode={stripeKeyMode}
          resetClearPlanIds={resetClearPlanIds}
          onResetClearPlanIdsChange={setResetClearPlanIds}
          onResetStripeBindings={resetStripeBindings}
          resetBusy={resetBusy}
        />
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
                  <th className="px-4 py-3">{t("superAdmin.billingColMercadoPago")}</th>
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
                    <td className="px-4 py-3">{plan.subscriptionCount}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {plan.amountCents > 0 && mercadoPagoPlatformConfigured ? (
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
                          onClick={() => openEditPlan(plan)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("superAdmin.billingEditPlan")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SuperAdminPanel>
      ) : null}

      {tab === "customPlans" && !loading ? <SuperAdminCustomPlansPanel /> : null}

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
                <option value="active">{translateBillingStatus(t, "active", "subscription")}</option>
                <option value="trialing">{translateBillingStatus(t, "trialing", "subscription")}</option>
                <option value="past_due">{translateBillingStatus(t, "past_due", "subscription")}</option>
                <option value="canceled">{translateBillingStatus(t, "canceled", "subscription")}</option>
                <option value="inactive">{translateBillingStatus(t, "inactive", "subscription")}</option>
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
                  <th className="px-4 py-3">{t("superAdmin.billingColDue")}</th>
                  <th className="px-4 py-3">{t("superAdmin.billingEmail")}</th>
                  <th className="px-4 py-3">Stripe Sub</th>
                  <th className="px-4 py-3" />
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
                      <span className="font-medium">{translateBillingStatus(t, sub.status, "subscription")}</span>
                      {sub.cancelAtPeriodEnd ? (
                        <span className="ml-2 text-xs text-amber-700">{t("superAdmin.billingCancelScheduled")}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{formatDate(sub.currentPeriodEnd, localeTag)}</td>
                    <td className="px-4 py-3">{formatDate(sub.paymentDueAt, localeTag)}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[220px] items-center gap-2">
                        <input
                          type="email"
                          value={billingEmailValue(sub)}
                          onChange={(e) =>
                            setBillingEmailDrafts((drafts) => ({
                              ...drafts,
                              [sub.organizationId]: e.target.value,
                            }))
                          }
                          placeholder={t("superAdmin.billingEmailPlaceholder")}
                          className="input-field text-xs"
                        />
                        <button
                          type="button"
                          className="btn-secondary shrink-0 px-2 py-1 text-xs"
                          disabled={billingEmailSaving === sub.organizationId}
                          onClick={() => void saveBillingEmail(sub.organizationId)}
                        >
                          {billingEmailSaving === sub.organizationId ? t("common.saving") : t("common.save")}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{sub.stripeSubscriptionId || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                        onClick={() => openReminderModal(sub)}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {t("superAdmin.billingSendReminder")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SuperAdminPanel>
      ) : null}

      {tab === "settings" && !loading ? (
        <SuperAdminPanel className="p-4">
          <form onSubmit={(e) => void saveSettings(e)} className="max-w-3xl space-y-6">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{t("superAdmin.billingSettingsTitle")}</h3>
              <p className="mt-1 text-sm text-slate-600">{t("superAdmin.billingSettingsHint")}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.billingGraceDays")}</label>
              <input
                type="number"
                min={0}
                max={90}
                value={billingSettings.gracePeriodDays}
                onChange={(e) =>
                  setBillingSettings((s) => ({ ...s, gracePeriodDays: Number(e.target.value) || 0 }))
                }
                className="input-field mt-1 w-32"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 p-4">
              <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingLimitEnforcementTitle")}</h4>
              <p className="text-sm text-slate-600">{t("superAdmin.billingLimitEnforcementHint")}</p>
              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="limitEnforcementMode"
                    checked={billingSettings.limitEnforcementMode === "block"}
                    onChange={() => setBillingSettings((s) => ({ ...s, limitEnforcementMode: "block" }))}
                  />
                  {t("superAdmin.billingLimitModeBlock")}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="limitEnforcementMode"
                    checked={billingSettings.limitEnforcementMode === "overage"}
                    onChange={() => setBillingSettings((s) => ({ ...s, limitEnforcementMode: "overage" }))}
                  />
                  {t("superAdmin.billingLimitModeOverage")}
                </label>
              </div>
            </div>

            {billingSettings.limitEnforcementMode === "overage" ? (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingOverageMetersTitle")}</h4>
                  <p className="mt-1 text-sm text-slate-600">{t("superAdmin.billingOverageMetersHint")}</p>
                </div>
                <div className="space-y-3">
                  {overageLimitKeys.map((key) => {
                    const dim = billingSettings.overage[key] ?? emptyOverageDimension(key);
                    return (
                      <div key={key} className="rounded-lg border border-slate-200 p-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={dim.enabled}
                            onChange={(e) =>
                              setBillingSettings((s) => ({
                                ...s,
                                overage: {
                                  ...s.overage,
                                  [key]: {
                                    ...(s.overage[key] ?? emptyOverageDimension(key)),
                                    enabled: e.target.checked,
                                  },
                                },
                              }))
                            }
                          />
                          {overageLimitLabel(t, key)}
                        </label>
                        {dim.enabled ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-medium text-slate-600">
                                {t("superAdmin.billingOverageMeterEventName")}
                              </label>
                              <input
                                value={dim.stripeMeterEventName}
                                onChange={(e) =>
                                  setBillingSettings((s) => ({
                                    ...s,
                                    overage: {
                                      ...s.overage,
                                      [key]: {
                                        ...(s.overage[key] ?? emptyOverageDimension(key)),
                                        stripeMeterEventName: e.target.value,
                                      },
                                    },
                                  }))
                                }
                                className="input-field mt-1 font-mono text-xs"
                                placeholder={defaultMeterEventName(key)}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600">
                                {t("superAdmin.billingOverageUnitPrice")}
                              </label>
                              <MoneyCentsInput
                                className="mt-1"
                                currency="BRL"
                                valueCents={dim.unitAmountCents}
                                onChangeCents={(unitAmountCents) =>
                                  setBillingSettings((s) => ({
                                    ...s,
                                    overage: {
                                      ...s.overage,
                                      [key]: {
                                        ...(s.overage[key] ?? emptyOverageDimension(key)),
                                        unitAmountCents,
                                      },
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <button type="submit" className="btn-primary" disabled={settingsSaving}>
              {settingsSaving ? t("common.saving") : t("common.save")}
            </button>
          </form>
        </SuperAdminPanel>
      ) : null}

      {reminderModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="card-surface w-full max-w-md p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900">{t("superAdmin.billingSendReminderTitle")}</h3>
            <p className="mt-2 text-sm text-slate-600">
              {t("superAdmin.billingSendReminderHint").replace("{org}", reminderModal.organizationName)}
            </p>
            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.billingEmail")}</label>
              <input
                type="email"
                value={reminderModal.billingEmail}
                onChange={(e) => setReminderModal((m) => (m ? { ...m, billingEmail: e.target.value } : m))}
                placeholder={t("superAdmin.billingEmailPlaceholder")}
                className="input-field mt-1 w-full"
              />
              <p className="mt-1 text-xs text-slate-500">{t("superAdmin.billingSendReminderEmailHint")}</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setReminderModal(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn-primary" disabled={reminderSending} onClick={() => void sendPaymentReminder()}>
                {reminderSending ? t("common.saving") : t("superAdmin.billingSendReminder")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {planModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-h-[90vh] w-full max-w-3xl overflow-auto p-6 shadow-xl">
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
                <MoneyCentsInput
                  className="mt-1"
                  currency={planForm.currency || "BRL"}
                  valueCents={planForm.amountCents}
                  onChangeCents={(amountCents) => setPlanForm((f) => ({ ...f, amountCents }))}
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
                <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingMercadoPagoPlanId")}</label>
                <input
                  value={planForm.mercadopagoPlanId}
                  onChange={(e) => setPlanForm((f) => ({ ...f, mercadopagoPlanId: e.target.value }))}
                  className="input-field mt-1"
                  placeholder={t("superAdmin.billingMercadoPagoPlanIdHint")}
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
              <PlanLimitsFeaturesEditor
                limitsJson={planForm.limitsJson}
                featuresJson={planForm.featuresJson}
                extrasJson={planForm.extrasJson}
                onLimitsJsonChange={(limitsJson) => setPlanForm((f) => ({ ...f, limitsJson }))}
                onFeaturesJsonChange={(featuresJson) => setPlanForm((f) => ({ ...f, featuresJson }))}
                onExtrasJsonChange={(extrasJson) => setPlanForm((f) => ({ ...f, extrasJson }))}
              />
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
