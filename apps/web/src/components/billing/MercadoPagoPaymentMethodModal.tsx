import { CreditCard, QrCode, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type MercadoPagoPaymentMethodChoice = "card" | "pix";

type MercadoPagoPaymentMethodModalProps = {
  planName: string;
  amountLabel: string;
  onClose: () => void;
  onSelect: (method: MercadoPagoPaymentMethodChoice) => void;
};

export function MercadoPagoPaymentMethodModal({
  planName,
  amountLabel,
  onClose,
  onSelect,
}: MercadoPagoPaymentMethodModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="card-surface w-full max-w-md p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
              {t("settings.billingPaymentMethodTitle")}
            </h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {t("settings.billingCheckoutMethodHint").replace("{plan}", planName).replace("{amount}", amountLabel)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-slate-100 dark:hover:bg-ink-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={() => onSelect("pix")}
            className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-left hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/40 dark:hover:bg-brand-950/60"
          >
            <QrCode className="h-5 w-5 text-brand-600" />
            <div>
              <div className="font-semibold text-ink-900 dark:text-ink-50">{t("settings.billingPaymentMethodPix")}</div>
              <div className="text-sm text-ink-500 dark:text-ink-400">{t("settings.billingPaymentMethodPixHint")}</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelect("card")}
            className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50 dark:border-soft-border dark:hover:bg-ink-900/40"
          >
            <CreditCard className="h-5 w-5 text-ink-600 dark:text-ink-300" />
            <div>
              <div className="font-semibold text-ink-900 dark:text-ink-50">{t("settings.billingPaymentMethodCard")}</div>
              <div className="text-sm text-ink-500 dark:text-ink-400">{t("settings.billingPaymentMethodCardHint")}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
