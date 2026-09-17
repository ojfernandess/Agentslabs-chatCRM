import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export type MercadoPagoPixCheckoutState = {
  sessionId: string;
  planName: string;
  amountLabel: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string | null;
  expiresAt: string | null;
};

type MercadoPagoPixCheckoutModalProps = {
  checkout: MercadoPagoPixCheckoutState;
  onClose: () => void;
  onApproved: () => void;
};

export function MercadoPagoPixCheckoutModal({
  checkout,
  onClose,
  onApproved,
}: MercadoPagoPixCheckoutModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(true);
  const [approved, setApproved] = useState(false);

  const copyPixCode = async () => {
    try {
      await navigator.clipboard.writeText(checkout.qrCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("settings.billingPixCopyError"));
    }
  };

  const pollStatus = useCallback(async () => {
    try {
      const res = await api.get<{ approved: boolean; paymentStatus: string }>(
        `/billing/checkout/${checkout.sessionId}/status`,
      );
      if (res.approved) {
        setApproved(true);
        setPolling(false);
        onApproved();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("settings.billingPixStatusError"));
    }
  }, [checkout.sessionId, onApproved, t]);

  useEffect(() => {
    if (!polling) return;
    void pollStatus();
    const timer = window.setInterval(() => {
      void pollStatus();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [pollStatus, polling]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="card-surface w-full max-w-lg p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
              {t("settings.billingPixCheckoutTitle")}
            </h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {t("settings.billingPixCheckoutHint").replace("{plan}", checkout.planName).replace("{amount}", checkout.amountLabel)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-slate-100 dark:hover:bg-ink-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        ) : null}

        {approved ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
            <Check className="h-5 w-5" />
            <span className="text-sm font-medium">{t("settings.billingPixApproved")}</span>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex justify-center">
              <img
                src={`data:image/png;base64,${checkout.qrCodeBase64}`}
                alt={t("settings.billingPixQrAlt")}
                className="h-56 w-56 rounded-xl border border-slate-200 bg-white p-3"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                {t("settings.billingPixCopyLabel")}
              </label>
              <div className="mt-1 flex gap-2">
                <textarea
                  readOnly
                  value={checkout.qrCode}
                  className="input-field min-h-[84px] flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => void copyPixCode()}
                  className="btn-secondary inline-flex shrink-0 items-center gap-1 px-3"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("settings.billingPixCopied") : t("settings.billingPixCopy")}
                </button>
              </div>
            </div>

            {checkout.expiresAt ? (
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {t("settings.billingPixExpires").replace("{date}", new Date(checkout.expiresAt).toLocaleString())}
              </p>
            ) : null}

            <div className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400">
              <Loader2 className={clsx("h-4 w-4", polling && "animate-spin")} />
              {t("settings.billingPixWaiting")}
            </div>

            {checkout.ticketUrl ? (
              <a
                href={checkout.ticketUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm font-medium text-brand-600 hover:underline"
              >
                {t("settings.billingPixOpenTicket")}
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
