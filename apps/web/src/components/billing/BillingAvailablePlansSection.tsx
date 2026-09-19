import { useMemo } from "react";
import clsx from "clsx";
import { BillingHorizontalCardRow } from "@/components/billing/BillingHorizontalCardRow";
import { BillingPlanCard, type BillingPlanCardPlan } from "@/components/billing/BillingPlanCard";
import { settingsCard } from "@/components/settings/settingsUi";

const PLAN_CAROUSEL_THRESHOLD = 4;

type BillingAvailablePlansSectionProps = {
  plans: BillingPlanCardPlan[];
  hasCustomPlanCatalog?: boolean;
  checkoutAvailable: boolean;
  busy: string | null;
  localeTag: string;
  t: (key: string) => string;
  formatMoney: (cents: number, currency: string, locale: string) => string;
  planShowsSubscribeAction: (plan: BillingPlanCardPlan) => boolean;
  planNeedsPayment: (plan: BillingPlanCardPlan) => boolean;
  onSubscribe: (plan: BillingPlanCardPlan) => void;
};

/** Destaca o plano intermédio (ex.: Growth) sem alterar ordem ou dados vindos da API. */
function resolveFeaturedPlanId(plans: BillingPlanCardPlan[]): string | null {
  if (plans.length < 3) return null;
  const growthPlan = plans.find((plan) => plan.slug === "growth");
  if (growthPlan) return growthPlan.id;
  return plans[1]?.id ?? null;
}

export function BillingAvailablePlansSection({
  plans,
  hasCustomPlanCatalog,
  checkoutAvailable,
  busy,
  localeTag,
  t,
  formatMoney,
  planShowsSubscribeAction,
  planNeedsPayment,
  onSubscribe,
}: BillingAvailablePlansSectionProps) {
  const featuredPlanId = useMemo(() => resolveFeaturedPlanId(plans), [plans]);
  const plansGridClassName = clsx(
    "grid items-stretch gap-6 lg:gap-8",
    plans.length === 1
      ? "mx-auto max-w-md grid-cols-1"
      : plans.length === 2
        ? "mx-auto max-w-4xl grid-cols-1 md:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  );

  return (
    <section className={settingsCard}>
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="mx-auto max-w-2xl text-center">
          <h3 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl dark:text-ink-50">
            {t("settings.billingAvailablePlans")}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-ink-500 sm:text-base dark:text-ink-400">
            {hasCustomPlanCatalog
              ? t("settings.billingCustomPlanCatalogHint")
              : t("settings.billingAvailablePlansHeroSubtitle")}
          </p>
        </header>

        <BillingHorizontalCardRow
          itemCount={plans.length}
          scrollThreshold={PLAN_CAROUSEL_THRESHOLD}
          gridClassName={plansGridClassName}
          scrollItemClassName="h-full w-[min(100%,320px)] shrink-0 sm:w-[300px] lg:w-[320px]"
          ariaLabelPrev={t("settings.billingCarouselPrev")}
          ariaLabelNext={t("settings.billingCarouselNext")}
        >
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={clsx(
                "h-full min-h-0",
                featuredPlanId === plan.id && plans.length >= 3 && "lg:-mt-1 lg:mb-1",
              )}
            >
              <BillingPlanCard
                plan={plan}
                localeTag={localeTag}
                checkoutAvailable={checkoutAvailable}
                busy={busy}
                featured={featuredPlanId === plan.id}
                showSubscribeAction={planShowsSubscribeAction(plan)}
                needsPayment={planNeedsPayment(plan)}
                onSubscribe={() => onSubscribe(plan)}
                t={t}
                formatMoney={formatMoney}
              />
            </div>
          ))}
        </BillingHorizontalCardRow>
      </div>
    </section>
  );
}
