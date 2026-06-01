import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export function ContactNvoipOtpPanel({
  contactId,
  phone,
}: {
  contactId: string;
  phone: string;
}) {
  const { t } = useI18n();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await api.post<{ challengeId: string }>(
        `/contacts/${contactId}/nvoip/otp/send`,
        { channel: "sms" },
      );
      setChallengeId(res.challengeId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.otp.sendError"));
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!challengeId || !code.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean }>(`/contacts/${contactId}/nvoip/otp/verify`, {
        challengeId,
        code: code.trim(),
      });
      if (res.ok) setVerified(true);
      else setError(t("nvoip.otp.invalidCode"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.otp.verifyError"));
    } finally {
      setVerifying(false);
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
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={sending}
          onClick={() => void sendCode()}
        >
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("nvoip.otp.sendCode")}
        </button>
        {challengeId ? (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("nvoip.otp.codePlaceholder")}
              className="w-28 rounded border border-slate-200 px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-950"
            />
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={verifying || !code.trim()}
              onClick={() => void verify()}
            >
              {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : t("nvoip.otp.verify")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
