import {
  Bot,
  Box,
  Calendar,
  Check,
  Database,
  Gauge,
  Infinity,
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
} from "@/lib/planCatalog";

export type BillingPlanCardPlan = {
  id: string;
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
};

type BillingPlanCardProps = {
  plan: BillingPlanCardPlan;
  localeTag: string;
  stripeConfigured: boolean;
  busy: string | null;
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
  stripeConfigured,
  busy,
  showSubscribeAction,
  needsPayment,
  onSubscribe,
  t,
  formatMoney,
}: BillingPlanCardProps) {
  const limitKeys = orderPlanLimitKeys(Object.keys(plan.limits)).filter((key) =>
    isPlanLimitEnabled(key, plan.limitEnabled ?? {}),
  );
  const enabledFeatures = Object.entries(plan.features).filter(([, enabled]) => enabled === true);
  const planExtras = Object.entries(plan.planExtras ?? {}).filter(([, value]) => Boolean(value?.trim()));

  const intervalLabel =
    plan.interval === "year" ? t("settings.billingYearlyBilling") : t("settings.billingMonthlyBilling");

  const priceLabel =
    plan.amountCents > 0
      ? `${formatMoney(plan.amountCents, plan.currency, localeTag)} / ${
          plan.interval === "month" ? t("settings.billingPerMonth") : plan.interval
        }`
      : t("settings.billingFreePlan");

  const isBusy =
    busy === `select-${plan.id}` ||
    busy === `checkout-${plan.id}` ||
    busy === `change-${plan.id}`;

  return (
    <article
      className={clsx(
        "flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-ink-900/40",
        plan.isCurrent
          ? "border-brand-300 ring-1 ring-brand-200 dark:border-brand-800 dark:ring-brand-900/50"
          : "border-slate-200/90 dark:border-soft-border",
      )}
    >
      <div className="h-1.5 bg-brand-600" aria-hidden />

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300">
            <Box className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">{plan.name}</h4>
              {plan.isCurrent ? (
                <span className="rounded-md bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t("settings.billingCurrentPlanBadge")}
                </span>
              ) : null}
            </div>
            {plan.description ? (
              <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{plan.description}</p>
            ) : null}
          </div>
        </div>

        <p className="mt-5 text-2xl font-bold text-brand-600 dark:text-brand-400">{priceLabel}</p>

        <div className="mt-4 grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/80 dark:divide-soft-border dark:border-soft-border dark:bg-ink-900/30">
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-ink-600 dark:text-ink-300">
            <Calendar className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
            <span>{intervalLabel}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-ink-600 dark:text-ink-300">
            <Infinity className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
            <span>{t("settings.billingNoSetupFee")}</span>
          </div>
        </div>

        {limitKeys.length > 0 ? (
          <div className="mt-6 border-t border-slate-100 pt-5 dark:border-soft-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {t("settings.billingPlanCapacity")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {limitKeys.map((key) => {
                const Icon = limitIcon(key);
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-soft-border dark:bg-ink-900/20"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-ink-900/60 dark:text-brand-300">
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-bold leading-none text-ink-900 dark:text-ink-50">
                        {formatLimitValue(plan.limits[key], localeTag, t)}
                      </p>
                      <p className="mt-1 truncate text-[11px] leading-tight text-ink-500 dark:text-ink-400">
                        {limitLabel(t, key)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {enabledFeatures.length > 0 || planExtras.length > 0 ? (
          <div className="mt-6 border-t border-slate-100 pt-5 dark:border-soft-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {t("settings.billingIncludedResources")}
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {enabledFeatures.map(([key]) => (
                <li key={key} className="flex items-start gap-2 text-sm text-ink-700 dark:text-ink-200">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  <span>{featureLabel(t, key)}</span>
                </li>
              ))}
              {planExtras.map(([key, value]) => (
                <li key={`extra-${key}`} className="flex items-start gap-2 text-sm text-ink-700 dark:text-ink-200">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  <span>
                    <span className="font-medium">{extraLabel(t, key)}:</span> {value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-auto pt-6">
          {showSubscribeAction ? (
            plan.isFree || plan.amountCents <= 0 ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={onSubscribe}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("settings.billingSelectPlan")}
              </button>
            ) : stripeConfigured && plan.requiresCheckout ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={onSubscribe}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {needsPayment ? t("settings.billingCompletePayment") : t("settings.billingSubscribe")}
              </button>
            ) : stripeConfigured && plan.stripeReady === false ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {t("settings.billingPlanStripePriceMissing")}
              </p>
            ) : !stripeConfigured ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-ink-500 dark:border-soft-border dark:bg-ink-900/30 dark:text-ink-400">
                {t("settings.billingPaidPlanRequiresStripe")}
              </p>
            ) : null
          ) : plan.isCurrent ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {t("settings.billingYourCurrentPlan")}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
