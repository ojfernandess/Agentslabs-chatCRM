import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type QrPayload = {
  status: string;
  linkedPhone: string | null;
  qrImageUrl: string;
  webhookUrl: string;
};

type StatusPayload = {
  status: string;
  linkedPhone: string | null;
  lastStatusAt: string | null;
  lastError: string | null;
};

function statusBadgeClass(status: string): string {
  if (status === "OPEN") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
  if (status === "CONNECTING") return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
  return "bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-ink-300";
}

export function WavoipQrConnectPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { t } = useI18n();
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    try {
      const [qrRes, statusRes] = await Promise.all([
        api.get<QrPayload>(`/settings/wavoip/devices/${deviceId}/qr`),
        api.get<StatusPayload>(`/settings/wavoip/devices/${deviceId}/status`),
      ]);
      setQr(qrRes);
      setStatus(statusRes);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.loadError"));
    } finally {
      setLoading(false);
    }
  }, [deviceId, t]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const currentStatus = status?.status ?? qr?.status ?? "DISCONNECTED";
  const connected = currentStatus === "OPEN";

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link
        to="/settings?section=wavoip"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-ink-400 dark:hover:text-ink-100"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("wavoip.backToSettings")}
      </Link>

      <h1 className="text-xl font-bold text-slate-900 dark:text-ink-50">{t("wavoip.qrTitle")}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-ink-400">{t("wavoip.qrSubtitle")}</p>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", statusBadgeClass(currentStatus))}>
          {t(`wavoip.status.${currentStatus}`)}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("wavoip.refresh")}
        </button>
      </div>

      {loading ? (
        <div className="mt-12 flex justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-brand-500" />
        </div>
      ) : connected ? (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50/80 p-10 text-center dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <CheckCircle2 className="h-16 w-16 text-emerald-600 dark:text-emerald-400" />
          <p className="mt-4 text-lg font-semibold text-emerald-900 dark:text-emerald-100">{t("wavoip.connected")}</p>
          {status?.linkedPhone && (
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">{status.linkedPhone}</p>
          )}
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center">
          {qr?.qrImageUrl ? (
            <img
              src={qr.qrImageUrl}
              alt={t("wavoip.qrAlt")}
              className="max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-lg dark:border-ink-700"
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 px-8 py-12 text-sm text-slate-500 dark:border-ink-700">
              {t("wavoip.qrUnavailable")}
            </div>
          )}
          <ol className="mt-8 list-decimal space-y-2 pl-5 text-sm text-slate-600 dark:text-ink-400">
            <li>{t("wavoip.qrStep1")}</li>
            <li>{t("wavoip.qrStep2")}</li>
            <li>{t("wavoip.qrStep3")}</li>
          </ol>
        </div>
      )}

      {qr?.webhookUrl && (
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-ink-700 dark:bg-ink-950/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ink-500">
            {t("wavoip.webhookUrlLabel")}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-600 dark:text-ink-300">{qr.webhookUrl}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-ink-400">{t("wavoip.webhookPanelHint")}</p>
        </div>
      )}
    </div>
  );
}
