import {
  Bot,
  Box,
  Check,
  Crown,
  Database,
  Gauge,
  Loader2,
  MessageSquare,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import {
  catalogExtraLabelKey,
  catalogFeatureLabelKey,
  catalogLimitLabelKey,
  isPlanLimitEnabled,
  orderPlanLimitKeys,
  isInternalPlanFeatureKey,
} from "@/lib/planCatalog";

export type BillingPlanCardPlan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  badgeLabel?: string | null;
  currency: string;
  amountCents: number;
  interval: string;
  trialDays: number | null;
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

type BillingPlanCardProps = {
  plan: BillingPlanCardPlan;
  localeTag: string;
  checkoutAvailable: boolean;
  busy: string | null;
  featured?: boolean;
  showSubscribeAction: boolean;
  needsPayment: boolean;
  onSubscribe: () => void;
  t: (key: string) => string;
  formatMoney: (cents: number, currency: string, locale: string) => string;
};

function limitIcon(key: string): LucideIcon {
  switch (key) {
    case "agents":
      return Bot;
    case "automations":
      return Workflow;
    case "contacts":
      return Database;
    case "messages":
      return MessageSquare;
    case "users":
    case "seats":
      return Users;
    default:
      return Gauge;
  }
}

function formatLimitValue(limit: number | null | undefined, locale: string, t: (key: string) => string): string {
  if (limit === null) return t("settings.billingLimitUnlimitedSymbol");
  if (limit === undefined) return "—";
  return new Intl.NumberFormat(locale).format(limit);
}

function limitLabel(t: (key: string) => string, key: string): string {
  const labelKey = catalogLimitLabelKey(key);
  return labelKey ? t(labelKey) : key.replace(/_/g, " ");
}

function featureLabel(t: (key: string) => string, key: string): string {
  const labelKey = catalogFeatureLabelKey(key);
  return labelKey ? t(labelKey) : key.replace(/_/g, " ");
}

function extraLabel(t: (key: string) => string, key: string): string {
  const labelKey = catalogExtraLabelKey(key);
  return labelKey ? t(labelKey) : key.replace(/_/g, " ");
}

export function BillingPlanCard({
  plan,
  localeTag,
  checkoutAvailable,
  busy,
  featured = false,
  showSubscribeAction,
  needsPayment,
  onSubscribe,
  t,
  formatMoney,
}: BillingPlanCardProps) {
  const limitKeys = orderPlanLimitKeys(Object.keys(plan.limits)).filter((key) =>
    isPlanLimitEnabled(key, plan.limitEnabled ?? {}),
  );
  const enabledFeatures = Object.entries(plan.features).filter(
    ([key, enabled]) => enabled === true && !isInternalPlanFeatureKey(key),
  );
  const planExtras = Object.entries(plan.planExtras ?? {}).filter(([, value]) => Boolean(value?.trim()));
  const badgeText = plan.isPendingCheckout
    ? null
    : plan.badgeLabel?.trim() || (featured ? t("settings.billingPopularPlanBadge") : null);
  const highlighted = (Boolean(badgeText) || featured) && !plan.isPendingCheckout;

  const isPaid = plan.amountCents > 0;
  const planCheckoutReady =
    !isPaid || Boolean(plan.stripeReady || plan.mercadopagoReady);
  const isBusy =
    busy === `select-${plan.id}` ||
    busy === `checkout-${plan.id}` ||
    busy === `change-${plan.id}`;

  const priceIntervalLabel =
    plan.interval === "year" ? t("settings.billingYearlyBilling") : t("settings.billingMonthlyBilling");

  return (
    <article
      className={clsx(
        "relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(103,52,255,0.08)] transition-shadow dark:bg-ink-900/50",
        highlighted
          ? "border-brand-400 ring-2 ring-brand-500/20 dark:border-brand-600 dark:ring-brand-500/30"
          : plan.isCurrent
            ? "border-brand-200 dark:border-brand-800/60"
            : "border-slate-200/90 dark:border-soft-border",
        highlighted && "shadow-[0_12px_40px_rgba(103,52,255,0.18)]",
      )}
    >
      {badgeText ? (
        <div className="flex items-center justify-center gap-1.5 bg-brand-600 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
          <Crown className="h-3.5 w-3.5" strokeWidth={2.25} />
          {badgeText}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col p-6 sm:p-7">
        <div className="shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300">
                <Box className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h4 className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">{plan.name}</h4>
                {plan.description ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                    {plan.description}
                  </p>
                ) : null}
              </div>
            </div>
            {plan.isCurrent && !plan.isPendingCheckout ? (
              <span className="shrink-0 rounded-full bg-brand-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
                {t("settings.billingCurrentPlanBadge")}
              </span>
            ) : null}
            {plan.isPendingCheckout ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                {t("settings.billingPendingCheckoutBadge")}
              </span>
            ) : null}
          </div>

          <div className="mt-6 border-b border-slate-100 pb-5 dark:border-soft-border">
            {isPaid ? (
              <div className="flex flex-wrap items-end gap-x-1.5 gap-y-1">
                <span className="text-3xl font-bold leading-none text-brand-600 sm:text-4xl dark:text-brand-400">
                  {formatMoney(plan.amountCents, plan.currency, localeTag)}
                </span>
                <span className="pb-1 text-base font-medium text-brand-600/80 dark:text-brand-400/80">
                  / {plan.interval === "month" ? t("settings.billingPerMonth") : plan.interval}
                </span>
              </div>
            ) : (
              <p className="text-3xl font-bold leading-none text-brand-600 sm:text-4xl dark:text-brand-400">
                {t("settings.billingFreePlan")}
              </p>
            )}
            <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
              {isPaid ? priceIntervalLabel : t("settings.billingFreePlanSubtitle")}
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {limitKeys.length > 0 ? (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {t("settings.billingPlanCapacity")}
              </p>
              <ul className="mt-3 space-y-2.5">
                {limitKeys.map((key) => {
                  const Icon = limitIcon(key);
                  return (
                    <li key={key} className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" strokeWidth={1.75} />
                        <span className="text-sm text-ink-600 dark:text-ink-300">{limitLabel(t, key)}</span>
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-ink-900 dark:text-ink-50">
                        {formatLimitValue(plan.limits[key], localeTag, t)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {enabledFeatures.length > 0 || planExtras.length > 0 ? (
            <div className="mt-6 border-t border-slate-100 pt-5 dark:border-soft-border">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                {t("settings.billingIncludedResources")}
              </p>
              <ul className="mt-3 space-y-2.5">
                {enabledFeatures.map(([key]) => (
                  <li key={key} className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-200">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 break-words leading-snug">{featureLabel(t, key)}</span>
                  </li>
                ))}
                {planExtras.map(([key, value]) => (
                  <li key={`extra-${key}`} className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-200">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 break-words leading-snug">
                      <span className="font-medium">{extraLabel(t, key)}:</span> {value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-auto shrink-0 pt-6">
          {showSubscribeAction ? (
            plan.isFree || plan.amountCents <= 0 ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={onSubscribe}
                className={clsx(
                  "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60",
                  highlighted
                    ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700"
                    : "border-2 border-brand-600 bg-white text-brand-600 hover:bg-brand-50 dark:bg-transparent dark:hover:bg-brand-950/30",
                )}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("settings.billingSelectPlan")}
              </button>
            ) : checkoutAvailable && plan.requiresCheckout && planCheckoutReady ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={onSubscribe}
                className={clsx(
                  "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60",
                  highlighted
                    ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700"
                    : "border-2 border-brand-600 bg-white text-brand-600 hover:bg-brand-50 dark:bg-transparent dark:hover:bg-brand-950/30",
                )}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {needsPayment ? t("settings.billingCompletePayment") : t("settings.billingSubscribe")}
              </button>
            ) : checkoutAvailable && plan.requiresCheckout && !planCheckoutReady ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {t("settings.billingPlanPaymentNotReady")}
              </p>
            ) : !checkoutAvailable ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-ink-500 dark:border-soft-border dark:bg-ink-900/30 dark:text-ink-400">
                {t("settings.billingPaidPlanRequiresPaymentProvider")}
              </p>
            ) : null
          ) : plan.isCurrent && !plan.isPendingCheckout ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {t("settings.billingYourCurrentPlan")}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
