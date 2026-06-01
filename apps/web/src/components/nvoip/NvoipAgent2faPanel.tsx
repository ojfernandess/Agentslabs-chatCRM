import { useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export function NvoipAgent2faPanel() {
  const { t } = useI18n();
  const [token2fa, setToken2fa] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-ink-700 dark:bg-ink-950/50">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-brand-600" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-ink-50">{t("nvoip.security2fa.title")}</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-ink-400">{t("nvoip.security2fa.hint")}</p>

      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {verified ? (
        <p className="mt-2 text-sm text-emerald-600">{t("nvoip.security2fa.verified")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={sending}
            onClick={() => {
              setSending(true);
              setError(null);
              void api
                .post<{ token2fa: string }>("/nvoip/security/2fa/send", {})
                .then((res) => setToken2fa(res.token2fa))
                .catch((e) =>
                  setError(e instanceof ApiError ? e.message : t("nvoip.security2fa.sendError")),
                )
                .finally(() => setSending(false));
            }}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.security2fa.send")}
          </button>
          {token2fa ? (
            <>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={t("nvoip.security2fa.pinPlaceholder")}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={verifying || !pin.trim()}
                onClick={() => {
                  setVerifying(true);
                  setError(null);
                  void api
                    .post<{ ok: boolean }>("/nvoip/security/2fa/verify", { token2fa, pin: pin.trim() })
                    .then((res) => {
                      if (res.ok) setVerified(true);
                      else setError(t("nvoip.security2fa.invalidPin"));
                    })
                    .catch((e) =>
                      setError(e instanceof ApiError ? e.message : t("nvoip.security2fa.verifyError")),
                    )
                    .finally(() => setVerifying(false));
                }}
              >
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.security2fa.verify")}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
