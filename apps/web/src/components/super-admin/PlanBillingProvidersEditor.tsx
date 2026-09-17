import { Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type PlanPaymentProvidersForm = {
  stripe: boolean;
  mercadopago: boolean;
};

type PlanBillingProvidersEditorProps = {
  amountCents: number;
  providers: PlanPaymentProvidersForm;
  onProvidersChange: (providers: PlanPaymentProvidersForm) => void;
  stripeProductId: string;
  stripePriceId: string;
  onStripeProductIdChange: (value: string) => void;
  onStripePriceIdChange: (value: string) => void;
  mercadopagoPlanId: string;
  onMercadopagoPlanIdChange: (value: string) => void;
  planId?: string | null;
  mercadoPagoPlatformConfigured?: boolean;
  generatingMercadoPago?: boolean;
  onGenerateMercadoPago?: () => void | Promise<void>;
};

export function PlanBillingProvidersEditor({
  amountCents,
  providers,
  onProvidersChange,
  stripeProductId,
  stripePriceId,
  onStripeProductIdChange,
  onStripePriceIdChange,
  mercadopagoPlanId,
  onMercadopagoPlanIdChange,
  planId,
  mercadoPagoPlatformConfigured = false,
  generatingMercadoPago = false,
  onGenerateMercadoPago,
}: PlanBillingProvidersEditorProps) {
  const { t } = useI18n();
  const isPaid = amountCents > 0;

  if (!isPaid) return null;

  return (
    <div className="sm:col-span-2 space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">{t("superAdmin.billingPlanProvidersTitle")}</h4>
        <p className="mt-1 text-xs text-slate-600">{t("superAdmin.billingPlanProvidersHint")}</p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-slate-800">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={providers.stripe}
            onChange={(e) => onProvidersChange({ ...providers, stripe: e.target.checked })}
          />
          Stripe
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={providers.mercadopago}
            onChange={(e) => onProvidersChange({ ...providers, mercadopago: e.target.checked })}
          />
          Mercado Pago
        </label>
      </div>
      {providers.stripe ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-ink-600">Stripe Product ID</label>
            <input
              value={stripeProductId}
              onChange={(e) => onStripeProductIdChange(e.target.value)}
              className="input-field mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-600">Stripe Price ID</label>
            <input
              value={stripePriceId}
              onChange={(e) => onStripePriceIdChange(e.target.value)}
              className="input-field mt-1"
            />
          </div>
        </div>
      ) : null}
      {providers.mercadopago ? (
        <div>
          <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingMercadoPagoPlanId")}</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={mercadopagoPlanId}
              onChange={(e) => onMercadopagoPlanIdChange(e.target.value)}
              className="input-field min-w-[16rem] flex-1"
              placeholder={t("superAdmin.billingMercadoPagoPlanIdHint")}
            />
            {planId && mercadoPagoPlatformConfigured ? (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                disabled={generatingMercadoPago}
                onClick={() => void onGenerateMercadoPago?.()}
              >
                {generatingMercadoPago ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t("superAdmin.billingGenerateMercadoPagoPlanId")}
              </button>
            ) : null}
          </div>
          {!planId && mercadoPagoPlatformConfigured ? (
            <p className="mt-1 text-xs text-slate-500">{t("superAdmin.billingMercadoPagoPlanIdAutoOnSave")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
