import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import {
  createEmbeddedSignupMessageHandler,
  initWhatsAppEmbeddedSignup,
  isValidEmbeddedBusinessData,
  setupFacebookSdk,
} from "@/lib/whatsappEmbeddedSdk";

interface WhatsappEmbeddedTenantInfo {
  available: boolean;
  appId: string | null;
  configurationId: string | null;
  apiVersion: string | null;
  orgWebhookUrl: string;
}

type Props = {
  onCompleted?: () => void;
  manualSetupHref?: string;
  onManualSetup?: () => void;
  className?: string;
};

export function WhatsAppEmbeddedSignupPanel({
  onCompleted,
  manualSetupHref,
  onManualSetup,
  className,
}: Props) {
  const { t } = useI18n();
  const [info, setInfo] = useState<WhatsappEmbeddedTenantInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const authCodeRef = useRef<string | null>(null);
  const businessDataRef = useRef<{
    business_id: string;
    waba_id: string;
    phone_number_id?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<WhatsappEmbeddedTenantInfo>("/settings/whatsapp-embedded")
      .then((emb) => {
        if (!cancelled) setInfo(emb);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tryFinishEmbedded = useCallback(async () => {
    const code = authCodeRef.current;
    const bd = businessDataRef.current;
    if (!code || !bd || !isValidEmbeddedBusinessData(bd)) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/settings/whatsapp-embedded/complete", {
        code,
        business_id: bd.business_id,
        waba_id: bd.waba_id,
        phone_number_id: bd.phone_number_id || undefined,
      });
      authCodeRef.current = null;
      businessDataRef.current = null;
      setSuccess(true);
      onCompleted?.();
    } catch (err) {
      authCodeRef.current = null;
      businessDataRef.current = null;
      setError(err instanceof Error ? err.message : t("settings.embeddedCompleteError"));
    } finally {
      setBusy(false);
    }
  }, [onCompleted, t]);

  useEffect(() => {
    if (!info?.available) return;
    const handler = createEmbeddedSignupMessageHandler((data) => {
      if (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        const bd = data.data;
        if (!isValidEmbeddedBusinessData(bd)) {
          setError(t("settings.embeddedInvalidBusiness"));
          return;
        }
        businessDataRef.current = bd;
        void tryFinishEmbedded();
      } else if (data.event === "CANCEL") {
        setBusy(false);
      } else if (data.event === "error") {
        setBusy(false);
        setError(data.error_message ?? t("settings.embeddedSignupError"));
      }
    });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [info?.available, tryFinishEmbedded, t]);

  const launch = async () => {
    if (!info?.appId || !info.configurationId || !info.apiVersion) return;
    setError("");
    setSuccess(false);
    setBusy(true);
    authCodeRef.current = null;
    businessDataRef.current = null;
    try {
      await setupFacebookSdk(info.appId, info.apiVersion);
      const code = await initWhatsAppEmbeddedSignup(info.configurationId);
      authCodeRef.current = code;
      if (businessDataRef.current) {
        await tryFinishEmbedded();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "Login cancelled") {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;

  if (!info.available) {
    return (
      <div className={className ?? "rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"}>
        {t("settings.embeddedUnavailable")}
      </div>
    );
  }

  return (
    <div className={className ?? "card-surface rounded-xl p-6"}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10">
          <WhatsAppBrandIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("settings.embeddedTitle")}</h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("settings.embeddedDesc")}</p>
          </div>
          <ul className="space-y-2 text-sm text-ink-700 dark:text-ink-300">
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
              <span>{t("settings.embeddedBenefit1")}</span>
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
              <span>{t("settings.embeddedBenefit2")}</span>
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
              <span>{t("settings.embeddedBenefit3")}</span>
            </li>
          </ul>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          {success ? <p className="text-sm text-green-700">{t("settings.embeddedSuccess")}</p> : null}
          <button
            type="button"
            onClick={() => void launch()}
            disabled={busy}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:w-auto dark:bg-soft-primary"
          >
            {busy ? t("settings.embeddedWorking") : t("settings.embeddedCta")}
          </button>
          {onManualSetup ? (
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {t("settings.embeddedManualHint")}{" "}
              <button
                type="button"
                onClick={onManualSetup}
                className="font-medium text-brand-600 underline hover:text-brand-700"
              >
                {t("settings.embeddedManualLink")}
              </button>
            </p>
          ) : manualSetupHref ? (
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {t("settings.embeddedManualHint")}{" "}
              <a href={manualSetupHref} className="font-medium text-brand-600 underline hover:text-brand-700">
                {t("settings.embeddedManualLink")}
              </a>
            </p>
          ) : (
            <p className="text-xs text-ink-500 dark:text-ink-400">{t("settings.embeddedManualHint")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
