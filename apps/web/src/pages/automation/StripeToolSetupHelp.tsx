import { useState } from "react";
import { CircleHelp, ExternalLink, X } from "lucide-react";

type Translate = (key: string) => string;

const STRIPE_WEBHOOKS_URL = "https://dashboard.stripe.com/webhooks";

const RECOMMENDED_EVENT_DESC_KEYS: Record<string, string> = {
  "checkout.session.completed": "automationPage.toolStripeEventDesc_checkout_session_completed",
  "checkout.session.async_payment_succeeded":
    "automationPage.toolStripeEventDesc_checkout_session_async_payment_succeeded",
  "payment_intent.succeeded": "automationPage.toolStripeEventDesc_payment_intent_succeeded",
};

const ADDITIONAL_EVENT_DESC_KEYS: Record<string, string> = {
  "checkout.session.expired": "automationPage.toolStripeEventDesc_checkout_session_expired",
  "payment_intent.payment_failed": "automationPage.toolStripeEventDesc_payment_intent_payment_failed",
  "invoice.paid": "automationPage.toolStripeEventDesc_invoice_paid",
  "invoice.payment_failed": "automationPage.toolStripeEventDesc_invoice_payment_failed",
  "customer.subscription.updated": "automationPage.toolStripeEventDesc_customer_subscription_updated",
  "customer.subscription.deleted": "automationPage.toolStripeEventDesc_customer_subscription_deleted",
};

function EventList({
  events,
  descKeys,
  t,
}: {
  events: string[];
  descKeys: Record<string, string>;
  t: Translate;
}) {
  if (events.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {events.map((event) => (
        <li key={event} className="text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
          <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[10px] text-ink-800 dark:bg-ink-800 dark:text-ink-100">
            {event}
          </code>
          <span className="mt-0.5 block pl-0.5">{t(descKeys[event] ?? event)}</span>
        </li>
      ))}
    </ul>
  );
}

export function StripeToolSetupHelp({
  t,
  webhookUrl,
  recommendedEvents,
  additionalEvents,
}: {
  t: Translate;
  webhookUrl: string;
  recommendedEvents: string[];
  additionalEvents: string[];
}) {
  const [open, setOpen] = useState(false);
  const helpLabel = t("automationPage.toolStripeSetupHelpOpen");

  return (
    <>
      <button
        type="button"
        aria-label={helpLabel}
        title={helpLabel}
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full p-0.5 text-ink-400 transition-colors hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:hover:text-brand-400"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stripe-tool-setup-help-title"
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-700">
              <h2 id="stripe-tool-setup-help-title" className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                {t("automationPage.toolStripeSetupHelpTitle")}
              </h2>
              <button
                type="button"
                aria-label={t("automationPage.toolStripeSetupHelpClose")}
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="space-y-5">
                <section>
                  <p className="text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                    {t("automationPage.toolStripeSetupHelpIntro")}
                  </p>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-ink-800 dark:text-ink-100">
                    {t("automationPage.toolStripeSetupHelpStepsTitle")}
                  </h3>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                    <li>{t("automationPage.toolStripeSetupHelpStep1")}</li>
                    <li>{t("automationPage.toolStripeSetupHelpStep2")}</li>
                    <li>
                      {t("automationPage.toolStripeSetupHelpStep3")}{" "}
                      <a
                        href={STRIPE_WEBHOOKS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Stripe Dashboard → Webhooks
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </li>
                    <li>{t("automationPage.toolStripeSetupHelpStep4")}</li>
                    <li>
                      {t("automationPage.toolStripeSetupHelpStep5")}
                      {webhookUrl ? (
                        <code className="mt-1 block break-all rounded bg-ink-100 px-2 py-1 font-mono text-[10px] text-ink-800 dark:bg-ink-800 dark:text-ink-100">
                          {webhookUrl}
                        </code>
                      ) : null}
                    </li>
                    <li>{t("automationPage.toolStripeSetupHelpStep6")}</li>
                    <li>{t("automationPage.toolStripeSetupHelpStep7")}</li>
                    <li>{t("automationPage.toolStripeSetupHelpStep8")}</li>
                  </ol>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-ink-800 dark:text-ink-100">
                    {t("automationPage.toolStripeSetupHelpRecommendedTitle")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                    {t("automationPage.toolStripeSetupHelpRecommendedIntro")}
                  </p>
                  <EventList events={recommendedEvents} descKeys={RECOMMENDED_EVENT_DESC_KEYS} t={t} />
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-ink-800 dark:text-ink-100">
                    {t("automationPage.toolStripeSetupHelpAdditionalTitle")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                    {t("automationPage.toolStripeSetupHelpAdditionalIntro")}
                  </p>
                  <EventList events={additionalEvents} descKeys={ADDITIONAL_EVENT_DESC_KEYS} t={t} />
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
