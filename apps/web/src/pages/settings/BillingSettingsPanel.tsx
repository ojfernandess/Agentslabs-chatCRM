import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CreditCard,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Gauge,
  MessageSquare,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  settingsCard,
  settingsMuted,
  settingsSubtitle,
  settingsTitle,
} from "@/components/settings/settingsUi";
import { BillingAvailablePlansSection } from "@/components/billing/BillingAvailablePlansSection";
import {
  MercadoPagoPixCheckoutModal,
  type MercadoPagoPixCheckoutState,
} from "@/components/billing/MercadoPagoPixCheckoutModal";
import {
  MercadoPagoPaymentMethodModal,
  type MercadoPagoPaymentMethodChoice,
} from "@/components/billing/MercadoPagoPaymentMethodModal";
import { UsageMeter } from "@/components/settings/UsageMeter";
import { translateBillingStatus } from "@/lib/billingStatusLabels";
import { catalogLimitLabelKey, orderPlanLimitKeys } from "@/lib/planCatalog";

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  currency: string;
  amountCents: number;
  interval: string;
  trialDays: number | null;
  limits: Record<string, number | null | undefined>;
  limitEnabled?: Record<string, boolean>;
  features: Record<string, boolean | undefined>;
  planExtras?: Record<string, string | undefined>;
  isCurrent: boolean;
  requiresCheckout: boolean;
  isFree?: boolean;
  stripeReady?: boolean;
  mercadopagoReady?: boolean;
  checkoutProviders?: {
    stripe?: boolean;
    mercadopago?: boolean;
  };
};

type BillingProviderSlice = {
  configured: boolean;
  connected: boolean;
  enabled?: boolean;
  publishableKey: string | null;
};

type UsageDimension = {
  used: number;
  limit: number | null;
  overLimit?: number;
};

type BillingOverview = {
  stripeConfigured: boolean;
  publishableKey: string | null;
  providers?: {
    stripe?: BillingProviderSlice;
    mercadopago?: BillingProviderSlice;
  };
  billingEmail: string | null;
  legacyPlanTier: string;
  usage?: {
    dimensions: Record<string, UsageDimension & { periodStart?: string }>;
    dimensionOrder: string[];
    enforcement?: {
      mode: "block" | "overage";
      overageConfigured: boolean;
    };
  };
  subscription: {
    status: string;
    stripeManaged: boolean;
    providerManaged?: boolean;
    paymentProvider?: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    trialEnd: string | null;
    plan: Omit<PlanRow, "isCurrent" | "requiresCheckout"> | null;
  } | null;
  entitlements?: {
    hasAccess: boolean;
    inGracePeriod: boolean;
    limits: Record<string, number | null | undefined>;
    features: Record<string, boolean | undefined>;
  } | null;
  hasCustomPlanCatalog?: boolean;
  paymentGrace?: {
    paymentPending: boolean;
    canCompletePayment: boolean;
    paymentDueAt: string | null;
    daysRemaining: number | null;
    paymentOverdue: boolean;
  };
};

type InvoiceRow = {
  id: string;
  number: string | null;
  status: string | null;
  amountPaid: number;
  currency: string;
  created: string;
  hostedInvoiceUrl: string | null;
};

function formatMoney(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale);
}

function statusLabelKey(status: string): string {
  return `settings.billingStatus_${status}`;
}

function limitMeterIcon(key: string): LucideIcon {
  switch (key) {
    case "agents":
      return Users;
    case "automations":
      return Workflow;
    case "contacts":
      return Users;
    case "messages":
      return MessageSquare;
    case "seats":
    case "users":
      return Users;
    default:
      return Gauge;
  }
}

function limitMeterLabel(t: (key: string) => string, key: string): string {
  const labelKey = catalogLimitLabelKey(key);
  return labelKey ? t(labelKey) : key.replace(/_/g, " ");
}

function resolveCheckoutProviderForPlan(
  plan: PlanRow,
  providers?: BillingOverview["providers"],
): "stripe" | "mercadopago" | null {
  const stripe = Boolean(plan.checkoutProviders?.stripe);
  const mercadopago = Boolean(plan.checkoutProviders?.mercadopago);
  if (mercadopago && !stripe) return "mercadopago";
  if (stripe && !mercadopago) return "stripe";
  if (stripe && mercadopago) {
    if (providers?.mercadopago?.connected && !providers?.stripe?.configured) return "mercadopago";
    return "stripe";
  }
  return null;
}

export function BillingSettingsPanel() {
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutNotice = searchParams.get("checkout");
  const setupNotice = searchParams.get("setup");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethodPlan, setPaymentMethodPlan] = useState<PlanRow | null>(null);
  const [pixCheckout, setPixCheckout] = useState<MercadoPagoPixCheckoutState | null>(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [ov, pl] = await Promise.all([
        api.get<BillingOverview>("/billing/overview"),
        api.get<{ plans: PlanRow[] }>("/billing/plans"),
      ]);
      setOverview(ov);
      setPlans(pl.plans);
      if (ov.stripeConfigured) {
        try {
          const inv = await api.get<{ invoices: InvoiceRow[] }>("/billing/invoices");
          setInvoices(inv.invoices);
        } catch {
          setInvoices([]);
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("settings.billingLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!checkoutNotice && !setupNotice) return;
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    next.delete("setup");
    setSearchParams(next, { replace: true });
  }, [checkoutNotice, setupNotice, searchParams, setSearchParams]);

  const currentPlan = overview?.subscription?.plan;
  const subscription = overview?.subscription;
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const mercadoPagoConfigured = Boolean(
    overview?.providers?.mercadopago?.connected && overview?.providers?.mercadopago?.enabled !== false,
  );
  const stripeConfigured = Boolean(overview?.stripeConfigured && overview?.providers?.stripe?.enabled !== false);
  const checkoutAvailable = Boolean(stripeConfigured || mercadoPagoConfigured);
  const providerManaged = Boolean(subscription?.providerManaged ?? subscription?.stripeManaged);

  const checkoutBanner = useMemo(() => {
    if (checkoutNotice === "success") {
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
          {t("settings.billingCheckoutSuccess")}
        </div>
      );
    }
    if (checkoutNotice === "cancel") {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {t("settings.billingCheckoutCancel")}
        </div>
      );
    }
    return null;
  }, [checkoutNotice, t]);

  const setupBanner = useMemo(() => {
    if (setupNotice === "success") {
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
          {t("settings.billingSetupSuccess")}
        </div>
      );
    }
    if (setupNotice === "cancel") {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {t("settings.billingSetupCancel")}
        </div>
      );
    }
    return null;
  }, [setupNotice, t]);

  const messagesRenewLabel = useMemo(() => {
    const end = subscription?.currentPeriodEnd;
    if (!end) return null;
    return t("settings.billingUsageRenews").replace("{date}", formatDate(end, localeTag));
  }, [subscription?.currentPeriodEnd, localeTag, t]);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("settings.billingActionError"));
    } finally {
      setBusy(null);
    }
  };

  const canCompletePayment =
    Boolean(overview?.paymentGrace?.canCompletePayment) &&
    checkoutAvailable &&
    Boolean(currentPlan && currentPlan.amountCents > 0);

  const planNeedsPayment = (plan: PlanRow) =>
    plan.isCurrent && canCompletePayment && plan.amountCents > 0;

  const planShowsSubscribeAction = (plan: PlanRow) => !plan.isCurrent || planNeedsPayment(plan);

  const completeCurrentPlanPayment = () => {
    if (!currentPlan) return;
    const planRow = plans.find((p) => p.id === currentPlan.id);
    if (planRow) void subscribeToPlan(planRow);
  };

  const startCheckout = async (
    plan: PlanRow,
    provider: "stripe" | "mercadopago",
    paymentMethod?: MercadoPagoPaymentMethodChoice,
    payerIdentificationNumber?: string,
  ) => {
    await runAction(`checkout-${plan.id}`, async () => {
      const res = await api.post<{
        url: string;
        sessionId: string;
        mode?: "redirect" | "pix";
        pix?: MercadoPagoPixCheckoutState;
      }>("/billing/checkout", {
        planId: plan.id,
        provider,
        paymentMethod,
        payerIdentificationNumber,
      });

      if (res.mode === "pix" && res.pix) {
        setPixCheckout({
          sessionId: res.sessionId,
          planName: plan.name,
          amountLabel: formatMoney(plan.amountCents, plan.currency, localeTag),
          qrCode: res.pix.qrCode,
          qrCodeBase64: res.pix.qrCodeBase64,
          ticketUrl: res.pix.ticketUrl,
          expiresAt: res.pix.expiresAt,
        });
        return;
      }

      window.location.href = res.url;
    });
  };

  const subscribeToPlan = async (plan: PlanRow) => {
    if (plan.isFree || plan.amountCents <= 0) {
      await runAction(`select-${plan.id}`, async () => {
        await api.post("/billing/select-plan", { planId: plan.id });
      });
      return;
    }
    if (providerManaged && subscription?.status !== "canceled" && subscription?.paymentProvider !== "mercadopago") {
      await runAction(`change-${plan.id}`, async () => {
        await api.post("/billing/change-plan", { planId: plan.id });
      });
      return;
    }

    const stripeCheckoutReady = Boolean(stripeConfigured && plan.checkoutProviders?.stripe);
    const mpPixCheckoutReady = Boolean(mercadoPagoConfigured && plan.checkoutProviders?.mercadopago);

    if (mpPixCheckoutReady) {
      setPaymentMethodPlan(plan);
      return;
    }

    const provider = resolveCheckoutProviderForPlan(plan, overview?.providers);
    if (!provider) {
      setError(t("settings.billingPaidPlanRequiresPaymentProvider"));
      return;
    }
    await startCheckout(plan, provider);
  };

  const handleMercadoPagoPaymentMethod = async (
    method: MercadoPagoPaymentMethodChoice,
    options?: { payerIdentificationNumber?: string },
  ) => {
    const plan = paymentMethodPlan;
    setPaymentMethodPlan(null);
    if (!plan) return;
    if (method === "card") {
      await startCheckout(plan, "stripe");
      return;
    }
    await startCheckout(plan, "mercadopago", "pix", options?.payerIdentificationNumber);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className={settingsTitle}>{t("settings.sectionBilling")}</h2>
        <p className={settingsSubtitle}>{t("settings.billingIntro")}</p>
      </div>

      {checkoutBanner}
      {setupBanner}

      {!overview?.entitlements?.hasAccess ? (
        <div
          className={clsx(
            settingsCard,
            "flex gap-3 border-red-200 bg-red-50 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100",
          )}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-2">
            <p className="font-semibold">{t("settings.billingAccessSuspended")}</p>
            {checkoutNotice === "cancel" ? (
              <p className="text-sm opacity-90">{t("settings.billingCheckoutCancel")}</p>
            ) : null}
            {overview?.paymentGrace?.paymentPending ? (
              <p className="text-sm opacity-90">
                {overview.paymentGrace.paymentOverdue
                  ? t("settings.billingPaymentOverdue")
                  : t("settings.billingPaymentPendingHint").replace(
                      "{days}",
                      String(overview.paymentGrace.daysRemaining ?? 0),
                    )}
              </p>
            ) : null}
            {canCompletePayment ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={completeCurrentPlanPayment}
                className="mt-1 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy?.startsWith("checkout-") || busy?.startsWith("change-") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                {t("settings.billingCompletePayment")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      ) : null}

      {overview?.entitlements?.hasAccess && overview?.paymentGrace?.paymentPending ? (
        <div
          className={clsx(
            settingsCard,
            "flex gap-3 text-sm",
            overview.paymentGrace.paymentOverdue
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
          )}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">{t("settings.billingPaymentPendingTitle")}</p>
            <p>
              {overview.paymentGrace.paymentOverdue
                ? t("settings.billingPaymentOverdue")
                : t("settings.billingPaymentPendingHint").replace(
                    "{days}",
                    String(overview.paymentGrace.daysRemaining ?? 0),
                  )}
            </p>
            {overview.paymentGrace.paymentDueAt ? (
              <p className="text-xs opacity-80">
                {t("settings.billingPaymentDueDate").replace(
                  "{date}",
                  formatDate(overview.paymentGrace.paymentDueAt, localeTag),
                )}
              </p>
            ) : null}
            {canCompletePayment ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={completeCurrentPlanPayment}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy?.startsWith("checkout-") || busy?.startsWith("change-") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                {t("settings.billingCompletePayment")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {overview && !checkoutAvailable ? (
        <div className={clsx(settingsCard, "flex gap-3 text-sm text-ink-700 dark:text-ink-200")}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p>{t("settings.billingPaymentProviderNotConfigured")}</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">{t("settings.billingPaymentProviderNotConfiguredHint")}</p>
          </div>
        </div>
      ) : null}

      {overview?.usage ? (
        <section className={clsx(settingsCard, "space-y-4")}>
          <div>
            <h3 className={settingsTitle}>{t("settings.billingUsageTitle")}</h3>
            <p className={settingsSubtitle}>
              {overview.usage.enforcement?.mode === "overage"
                ? t("settings.billingUsageIntroOverage")
                : t("settings.billingUsageIntro")}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {(overview.usage.dimensionOrder.length > 0
              ? overview.usage.dimensionOrder
              : orderPlanLimitKeys(Object.keys(overview.usage.dimensions))
            ).map((key) => {
              const dim = overview.usage!.dimensions[key];
              if (!dim) return null;
              const mode = overview.usage!.enforcement?.mode ?? "block";
              const over = dim.overLimit ?? Math.max(0, dim.used - (dim.limit ?? dim.used));
              const overLimitHint =
                dim.limit !== null && dim.used > dim.limit
                  ? mode === "overage"
                    ? t("settings.billingUsageOverLimitOverage").replace("{count}", String(over))
                    : t("settings.billingUsageOverLimitBlock")
                  : null;
              const renewLabel = key === "messages" ? messagesRenewLabel : null;
              return (
                <UsageMeter
                  key={key}
                  label={limitMeterLabel(t, key)}
                  icon={limitMeterIcon(key)}
                  used={dim.used}
                  limit={dim.limit}
                  overLimit={over}
                  enforcementMode={mode}
                  overLimitHint={overLimitHint}
                  renewLabel={renewLabel}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={settingsCard}>
        <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("settings.billingCurrentPlan")}</h3>
        {currentPlan ? (
          <div className="mt-4 space-y-2">
            <p className="text-lg font-semibold text-ink-900 dark:text-ink-50">{currentPlan.name}</p>
            <p className={settingsMuted}>
              {currentPlan.amountCents > 0
                ? `${formatMoney(currentPlan.amountCents, currentPlan.currency, localeTag)} / ${currentPlan.interval === "month" ? t("settings.billingPerMonth") : currentPlan.interval}`
                : t("settings.billingFreePlan")}
            </p>
            {subscription ? (
              <>
                <p className="text-sm text-ink-600 dark:text-ink-300">
                  {t("settings.billingStatus")}:{" "}
                  <span className="font-medium">{t(statusLabelKey(subscription.status))}</span>
                </p>
                {subscription.currentPeriodEnd ? (
                  <p className="text-sm text-ink-600 dark:text-ink-300">
                    {subscription.cancelAtPeriodEnd
                      ? t("settings.billingActiveUntil")
                      : t("settings.billingNextCharge")}{" "}
                    {formatDate(subscription.currentPeriodEnd, localeTag)}
                  </p>
                ) : null}
                {subscription.status === "past_due" ? (
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    {t("settings.billingPastDueHint")}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <p className={clsx(settingsMuted, "mt-3")}>{t("settings.billingNoPlan")}</p>
        )}

        {overview?.stripeConfigured ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void runAction("setup-pm", async () => {
                  const res = await api.post<{ url: string }>("/billing/setup-payment-method", {});
                  window.location.href = res.url;
                })
              }
              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-800 dark:bg-transparent dark:text-brand-300 dark:hover:bg-brand-950/30 disabled:opacity-60"
            >
              {busy === "setup-pm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {t("settings.billingAddPaymentMethod")}
            </button>
            {subscription?.stripeManaged ? (
              <>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction("portal", async () => {
                      const res = await api.post<{ url: string }>("/billing/portal", {});
                      window.location.href = res.url;
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {t("settings.billingManage")}
                </button>
                {subscription.cancelAtPeriodEnd ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runAction("resume", () => api.post("/billing/resume", {}))}
                    className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50 dark:border-soft-border dark:text-ink-100 dark:hover:bg-white/5 disabled:opacity-60"
                  >
                    {t("settings.billingResume")}
                  </button>
                ) : subscription.status === "active" || subscription.status === "trialing" ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runAction("cancel", () => api.post("/billing/cancel", { cancelAtPeriodEnd: true }))
                    }
                    className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30 disabled:opacity-60"
                  >
                    {t("settings.billingCancel")}
                  </button>
                ) : null}
              </>
            ) : null}
            <p className="w-full text-xs text-ink-500 dark:text-ink-400">{t("settings.billingPaymentMethodHint")}</p>
          </div>
        ) : null}
      </section>

      <BillingAvailablePlansSection
        plans={plans}
        hasCustomPlanCatalog={overview?.hasCustomPlanCatalog}
        checkoutAvailable={checkoutAvailable}
        busy={busy}
        localeTag={localeTag}
        t={t}
        formatMoney={formatMoney}
        planShowsSubscribeAction={planShowsSubscribeAction}
        planNeedsPayment={planNeedsPayment}
        onSubscribe={(plan) => void subscribeToPlan(plan)}
      />

      {invoices.length > 0 ? (
        <section className={settingsCard}>
          <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("settings.billingHistory")}</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-ink-500 dark:border-soft-border dark:text-ink-400">
                  <th className="py-2 pr-4">{t("settings.billingHistoryDate")}</th>
                  <th className="py-2 pr-4">{t("settings.billingHistoryAmount")}</th>
                  <th className="py-2 pr-4">{t("settings.billingHistoryStatus")}</th>
                  <th className="py-2">{t("settings.billingHistoryInvoice")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-ink-100 dark:border-soft-border/60">
                    <td className="py-2 pr-4 text-ink-800 dark:text-ink-200">{formatDate(inv.created, localeTag)}</td>
                    <td className="py-2 pr-4 text-ink-800 dark:text-ink-200">{formatMoney(inv.amountPaid, inv.currency, localeTag)}</td>
                    <td className="py-2 pr-4 text-ink-800 dark:text-ink-200">{translateBillingStatus(t, inv.status, "invoice")}</td>
                    <td className="py-2">
                      {inv.hostedInvoiceUrl ? (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {t("settings.billingViewInvoice")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {paymentMethodPlan ? (
        <MercadoPagoPaymentMethodModal
          planName={paymentMethodPlan.name}
          amountLabel={formatMoney(paymentMethodPlan.amountCents, paymentMethodPlan.currency, localeTag)}
          stripeAvailable={Boolean(stripeConfigured && paymentMethodPlan.checkoutProviders?.stripe)}
          mercadoPagoPixAvailable={Boolean(
            mercadoPagoConfigured && paymentMethodPlan.checkoutProviders?.mercadopago,
          )}
          onClose={() => setPaymentMethodPlan(null)}
          onSelect={(method, options) => void handleMercadoPagoPaymentMethod(method, options)}
        />
      ) : null}

      {pixCheckout ? (
        <MercadoPagoPixCheckoutModal
          checkout={pixCheckout}
          onClose={() => setPixCheckout(null)}
          onApproved={() => {
            setPixCheckout(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
