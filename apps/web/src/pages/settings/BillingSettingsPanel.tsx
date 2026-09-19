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
import {
  AI_CREDIT_RECOMMENDED_PACKAGE_SLUG,
  aiCreditPackageTierLabel,
  formatAiCreditsBalance,
  formatAiCreditsHistoryAmount,
  formatAiCreditsPackageCount,
} from "@/lib/aiCreditsDisplay";
import { useI18n } from "@/i18n/I18nProvider";
import {
  settingsCard,
  settingsMuted,
  settingsSubtitle,
  settingsTitle,
} from "@/components/settings/settingsUi";
import { BillingAvailablePlansSection } from "@/components/billing/BillingAvailablePlansSection";
import { BillingHorizontalCardRow } from "@/components/billing/BillingHorizontalCardRow";
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
import { catalogLimitLabelKey, orderPlanLimitKeys, sortPlansByDisplayOrder } from "@/lib/planCatalog";

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  badgeLabel?: string | null;
  currency: string;
  amountCents: number;
  interval: string;
  trialDays: number | null;
  displayOrder?: number;
  limits: Record<string, number | null | undefined>;
  limitEnabled?: Record<string, boolean>;
  features: Record<string, boolean | undefined>;
  planExtras?: Record<string, string | undefined>;
  isCurrent: boolean;
  isPendingCheckout?: boolean;
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
  packageName: string;
  paymentProvider: string;
  status: string;
  creditAmount: string;
  amountCents: number;
  currency: string;
  completedAt: string | null;
  createdAt: string;
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
    isPaid?: boolean;
    stripeManaged: boolean;
    providerManaged?: boolean;
    paymentProvider?: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    trialEnd: string | null;
    plan: Omit<PlanRow, "isCurrent" | "isPendingCheckout" | "requiresCheckout"> | null;
    pendingPlan?: Omit<PlanRow, "isCurrent" | "isPendingCheckout" | "requiresCheckout"> | null;
  } | null;
  entitlements?: {
    hasAccess: boolean;
    inGracePeriod: boolean;
    grantsPaidEntitlements?: boolean;
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
    pendingPlanName?: string | null;
  };
  aiBillingMode?: "OWN_API_KEY" | "PLATFORM_CREDITS";
  aiCredits?: {
    organizationId: string;
    balance: string;
    reservedBalance: string;
    availableBalance: string;
    currency: string;
  } | null;
  aiCreditPackages?: AiCreditPackageRow[] | null;
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
  const aiCreditsNotice = searchParams.get("ai_credits");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [paymentMethodPlan, setPaymentMethodPlan] = useState<PlanRow | null>(null);
  const [aiCreditPackagePending, setAiCreditPackagePending] = useState<AiCreditPackageRow | null>(null);
  const [aiCreditPurchases, setAiCreditPurchases] = useState<AiCreditPurchaseRow[]>([]);
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
      if (ov.aiBillingMode === "PLATFORM_CREDITS") {
        try {
          const purchasesRes = await api.get<{ purchases: AiCreditPurchaseRow[] }>(
            "/billing/ai-credits/purchases",
          );
          setAiCreditPurchases(purchasesRes.purchases);
        } catch {
          setAiCreditPurchases([]);
        }
      } else {
        setAiCreditPurchases([]);
      }
      const shouldLoadInvoices = Boolean(
        ov.stripeConfigured ||
          (ov.providers?.mercadopago?.configured && ov.subscription?.paymentProvider === "mercadopago"),
      );
      if (shouldLoadInvoices) {
        try {
          const inv = await api.get<{ invoices: InvoiceRow[] }>("/billing/invoices");
          setInvoices(inv.invoices);
        } catch {
          setInvoices([]);
        }
      } else {
        setInvoices([]);
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
  const pendingPlan = overview?.subscription?.pendingPlan ?? null;
  const subscription = overview?.subscription;
  const showRenewalDate = Boolean(subscription?.isPaid && subscription.currentPeriodEnd);
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const mercadoPagoConfigured = Boolean(
    overview?.providers?.mercadopago?.connected && overview?.providers?.mercadopago?.enabled !== false,
  );
  const stripeConfigured = Boolean(overview?.stripeConfigured && overview?.providers?.stripe?.enabled !== false);

  const visibleAiCreditPackages = useMemo(() => {
    return [...(overview?.aiCreditPackages ?? [])]
      .filter((pkg) => pkg.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }, [overview?.aiCreditPackages]);

  const orderedPlans = useMemo(() => sortPlansByDisplayOrder(plans), [plans]);

  const aiCreditPurchaseStatusLabel = (status: string) => {
    const key = `settings.aiCreditsPurchaseStatus_${status.toLowerCase()}`;
    const translated = t(key);
    return translated !== key ? translated : status;
  };
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
    const end = showRenewalDate ? subscription?.currentPeriodEnd : null;
    if (!end) return null;
    return t("settings.billingUsageRenews").replace("{date}", formatDate(end, localeTag));
  }, [showRenewalDate, subscription?.currentPeriodEnd, localeTag, t]);

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
    Boolean(pendingPlan && pendingPlan.amountCents > 0);

  const pendingPlanName =
    overview?.paymentGrace?.pendingPlanName?.trim() || pendingPlan?.name?.trim() || "";

  const formatPaymentPendingHint = () => {
    if (!pendingPlanName) {
      return t("settings.billingPaymentPendingHintGeneric");
    }
    if (overview?.paymentGrace?.paymentDueAt) {
      return t("settings.billingPaymentPendingHint")
        .replace("{planName}", pendingPlanName)
        .replace("{days}", String(overview.paymentGrace.daysRemaining ?? 0));
    }
    return t("settings.billingCheckoutPaymentPendingHint").replace("{planName}", pendingPlanName);
  };

  const planNeedsPayment = (plan: PlanRow) =>
    Boolean(plan.isPendingCheckout) && canCompletePayment && plan.amountCents > 0;

  const planShowsSubscribeAction = (plan: PlanRow) => !plan.isCurrent || planNeedsPayment(plan);

  const completeCurrentPlanPayment = () => {
    if (!pendingPlan) return;
    const planRow = plans.find((p) => p.id === pendingPlan.id);
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

  const startAiCreditCheckout = async (
    pkg: AiCreditPackageRow,
    provider: "stripe" | "mercadopago",
    paymentMethod?: MercadoPagoPaymentMethodChoice,
    payerIdentificationNumber?: string,
  ) => {
    await runAction(`ai-credit-${pkg.id}`, async () => {
      const res = await api.post<{
        url: string;
        sessionId: string;
        mode?: "redirect" | "pix";
        pix?: {
          qrCode: string;
          qrCodeBase64: string;
          ticketUrl: string | null;
          expiresAt: string | null;
        };
      }>("/billing/ai-credits/checkout", {
        packageId: pkg.id,
        provider,
        paymentMethod,
        payerIdentificationNumber,
      });

      if (res.mode === "pix" && res.pix) {
        setPixCheckout({
          sessionId: res.sessionId,
          planName: pkg.name,
          amountLabel: formatMoney(pkg.amountCents, pkg.currency, localeTag),
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

  const buyAiCreditPackage = async (pkg: AiCreditPackageRow) => {
    if (!checkoutAvailable) {
      setError(t("settings.aiCreditsCheckoutUnavailable"));
      return;
    }
    if (mercadoPagoConfigured) {
      setAiCreditPackagePending(pkg);
      return;
    }
    if (stripeConfigured) {
      await startAiCreditCheckout(pkg, "stripe");
      return;
    }
    setError(t("settings.aiCreditsCheckoutUnavailable"));
  };

  const handleAiCreditPaymentMethod = async (
    method: MercadoPagoPaymentMethodChoice,
    options?: { payerIdentificationNumber?: string },
  ) => {
    const pkg = aiCreditPackagePending;
    setAiCreditPackagePending(null);
    if (!pkg) return;
    if (method === "card") {
      if (stripeConfigured) {
        await startAiCreditCheckout(pkg, "stripe");
        return;
      }
      setError("Checkout com cartão indisponível — configure Stripe.");
      return;
    }
    await startAiCreditCheckout(pkg, "mercadopago", "pix", options?.payerIdentificationNumber);
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
              <p className="text-sm opacity-90">{formatPaymentPendingHint()}</p>
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
                : formatPaymentPendingHint()}
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

      {overview?.aiBillingMode === "PLATFORM_CREDITS" && overview.aiCredits ? (
        <section className={clsx(settingsCard, "space-y-6")}>
          <div>
            <h3 className={settingsTitle}>{t("settings.aiCreditsSectionTitle")}</h3>
            <p className={settingsSubtitle}>{t("settings.aiCreditsSectionSubtitle")}</p>
          </div>
          {aiCreditsNotice === "success" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              {t("settings.aiCreditsPurchaseSuccess")}
            </div>
          ) : null}
          <div className="rounded-xl border border-ink-200/80 bg-ink-50/40 p-4 dark:border-ink-700/80 dark:bg-ink-900/20">
            <p className={settingsMuted}>{t("settings.aiCreditsAvailableLabel")}</p>
            <p className="mt-1 text-2xl font-semibold text-ink-900 dark:text-ink-50">
              {formatAiCreditsBalance(
                overview.aiCredits.availableBalance,
                localeTag,
                t("settings.aiCreditsUnitShort"),
              )}
            </p>
            <div className="mt-3 grid gap-2 text-xs text-ink-500 dark:text-ink-400 sm:grid-cols-2">
              <p>
                {t("settings.aiCreditsTotalLabel")}:{" "}
                {formatAiCreditsBalance(
                  overview.aiCredits.balance,
                  localeTag,
                  t("settings.aiCreditsUnitShort"),
                )}
              </p>
              <p>
                {t("settings.aiCreditsReservedLabel")}:{" "}
                {formatAiCreditsBalance(
                  overview.aiCredits.reservedBalance,
                  localeTag,
                  t("settings.aiCreditsUnitShort"),
                )}
              </p>
            </div>
          </div>

          {visibleAiCreditPackages.length > 0 ? (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                  {t("settings.aiCreditsPackagesTitle")}
                </h4>
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                  {t("settings.aiCreditsPackagesIntro")}
                </p>
              </div>
              <BillingHorizontalCardRow
                itemCount={visibleAiCreditPackages.length}
                scrollThreshold={6}
                gridClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"
                scrollGapClassName="gap-4"
                scrollItemClassName="w-[min(100%,260px)] shrink-0 sm:w-[220px] xl:w-[210px] 2xl:w-[200px]"
                ariaLabelPrev={t("settings.billingCarouselPrev")}
                ariaLabelNext={t("settings.billingCarouselNext")}
              >
                {visibleAiCreditPackages.map((pkg) => {
                  const badgeText =
                    pkg.badgeLabel?.trim() ||
                    (pkg.slug === AI_CREDIT_RECOMMENDED_PACKAGE_SLUG
                      ? t("settings.aiCreditsRecommendedBadge")
                      : null);
                  const highlighted = Boolean(badgeText);
                  const creditCount = formatAiCreditsPackageCount(pkg.creditAmount, localeTag);
                  return (
                    <div
                      key={pkg.id}
                      className={clsx(
                        "relative flex min-h-[220px] flex-col rounded-xl border p-5",
                        highlighted
                          ? "border-brand-500/50 bg-brand-50/40 shadow-sm ring-1 ring-brand-500/20 dark:border-brand-500/40 dark:bg-brand-950/20"
                          : "border-ink-200/80 dark:border-ink-700/80",
                      )}
                    >
                      {badgeText ? (
                        <span className="absolute -top-2.5 left-4 rounded-full bg-brand-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          {badgeText}
                        </span>
                      ) : null}
                      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                        {aiCreditPackageTierLabel(pkg.slug)}
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-ink-900 dark:text-ink-50">
                        {t("settings.aiCreditsPackageCreditsLine").replace("{count}", creditCount)}
                      </p>
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                        {pkg.description ?? ""}
                      </p>
                      <p className="mt-4 text-xl font-semibold text-ink-900 dark:text-ink-50">
                        {formatMoney(pkg.amountCents, pkg.currency, localeTag)}
                      </p>
                      <button
                        type="button"
                        className={clsx("btn-primary mt-4 w-full", highlighted && "shadow-sm")}
                        disabled={busy === `ai-credit-${pkg.id}` || !checkoutAvailable}
                        onClick={() => void buyAiCreditPackage(pkg)}
                      >
                        {busy === `ai-credit-${pkg.id}` ? (
                          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        ) : (
                          t("settings.aiCreditsBuyButton")
                        )}
                      </button>
                    </div>
                  );
                })}
              </BillingHorizontalCardRow>
            </div>
          ) : null}

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
              {t("settings.aiCreditsPurchaseHistoryTitle")}
            </h4>
            {aiCreditPurchases.length === 0 ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">
                {t("settings.aiCreditsPurchaseHistoryEmpty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ink-200/80 dark:border-ink-700/80">
                <table className="min-w-full text-sm">
                  <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-900/40">
                    <tr>
                      <th className="px-3 py-2">{t("settings.aiCreditsHistoryColPackage")}</th>
                      <th className="px-3 py-2">{t("settings.aiCreditsHistoryColCredits")}</th>
                      <th className="px-3 py-2">{t("settings.aiCreditsHistoryColAmount")}</th>
                      <th className="px-3 py-2">{t("settings.aiCreditsHistoryColStatus")}</th>
                      <th className="px-3 py-2">{t("settings.aiCreditsHistoryColDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiCreditPurchases.map((row) => (
                      <tr key={row.id} className="border-t border-ink-100 dark:border-ink-800">
                        <td className="px-3 py-2">{row.packageName}</td>
                        <td className="px-3 py-2">
                          {formatAiCreditsHistoryAmount(
                            row.creditAmount,
                            localeTag,
                            t("settings.aiCreditsUnitShort"),
                          )}
                        </td>
                        <td className="px-3 py-2">{formatMoney(row.amountCents, row.currency, localeTag)}</td>
                        <td className="px-3 py-2">{aiCreditPurchaseStatusLabel(row.status)}</td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {formatDate(row.completedAt ?? row.createdAt, localeTag)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
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
            {overview.usage.dimensions.automations ? (
              <p className={clsx(settingsMuted, "text-xs")}>{t("settings.billingUsageAutomationsHint")}</p>
            ) : null}
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
                {showRenewalDate ? (
                  <p className="text-sm text-ink-600 dark:text-ink-300">
                    {subscription.cancelAtPeriodEnd
                      ? t("settings.billingActiveUntil")
                      : t("settings.billingNextCharge")}{" "}
                    {formatDate(subscription.currentPeriodEnd, localeTag)}
                  </p>
                ) : null}
                {pendingPlan ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="font-medium">{t("settings.billingPendingPlanTitle")}</p>
                    <p className="mt-1">
                      {pendingPlan.name} —{" "}
                      {formatMoney(pendingPlan.amountCents, pendingPlan.currency, localeTag)} /{" "}
                      {pendingPlan.interval === "month"
                        ? t("settings.billingPerMonth")
                        : pendingPlan.interval}
                    </p>
                    <p className="mt-1 text-xs opacity-90">{formatPaymentPendingHint()}</p>
                  </div>
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
        plans={orderedPlans}
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

      {aiCreditPackagePending ? (
        <MercadoPagoPaymentMethodModal
          planName={aiCreditPackagePending.name}
          amountLabel={formatMoney(
            aiCreditPackagePending.amountCents,
            aiCreditPackagePending.currency,
            localeTag,
          )}
          stripeAvailable={stripeConfigured}
          mercadoPagoPixAvailable={mercadoPagoConfigured}
          onClose={() => setAiCreditPackagePending(null)}
          onSelect={(method, options) => void handleAiCreditPaymentMethod(method, options)}
        />
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
