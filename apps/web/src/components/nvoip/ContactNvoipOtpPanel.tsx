import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipAuthWidget } from "@/hooks/useNvoipAuthWidget";

export function ContactNvoipOtpPanel({
  contactId,
  phone,
}: {
  contactId: string;
  phone: string;
}) {
  const { t } = useI18n();
  const { openWidget } = useNvoipAuthWidget();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      await openWidget({
        phone: phone.trim(),
        contactId,
        purpose: "contact_phone_verify",
        allowPhoneEdit: false,
        accountLabel: phone.trim(),
        onSuccess: () => {
          setVerified(true);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("nvoip.otp.sendError"));
    } finally {
      setLoading(false);
    }
  };

  if (verified) {
    return (
      <p className="flex items-center gap-1 text-sm text-emerald-600">
        <ShieldCheck className="h-4 w-4" />
        {t("nvoip.otp.verified")}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-ink-800">
      <p className="text-sm font-medium text-slate-800 dark:text-ink-200">{t("nvoip.otp.panelTitle")}</p>
      <p className="mt-1 text-xs text-slate-500">{t("nvoip.otp.panelHint").replace("{phone}", phone)}</p>
      <p className="mt-1 text-xs text-slate-500">{t("nvoip.webSdk.contactHint")}</p>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <div className="mt-3">
        <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => void open()}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : t("nvoip.webSdk.openWidget")}
        </button>
      </div>
    </div>
  );
}
