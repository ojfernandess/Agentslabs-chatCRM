import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { QRCodeSVG } from "qrcode.react";
import { Wavoip, type Device, type DeviceStatus } from "@wavoip/wavoip-api";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type QrPayload = {
  status: string;
  connectionMode: string;
  linkedPhone: string | null;
  deviceToken: string;
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
  if (status === "OPEN" || status === "open") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
  }
  if (status === "CONNECTING" || status === "connecting") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
  }
  if (status === "BUILDING" || status === "RESTARTING" || status === "restarting") {
    return "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-ink-300";
}

function mapSdkStatusToLabel(status: DeviceStatus | string): string {
  const s = status.toString().toUpperCase();
  if (s === "OPEN") return "OPEN";
  if (s === "CONNECTING") return "CONNECTING";
  if (s === "BUILDING") return "BUILDING";
  if (s === "RESTARTING") return "RESTARTING";
  if (s === "DISCONNECTED" || s === "CLOSE") return "DISCONNECTED";
  return s;
}

function needsWakeUp(status: DeviceStatus): boolean {
  return ["disconnected", "close", "hibernating", "error"].includes(status);
}

async function ensureDevicePairing(device: Device): Promise<void> {
  if (device.status === "open") return;
  if (needsWakeUp(device.status)) {
    await device.wakeUp();
  }
  if (!device.qrCode && device.status !== "connecting") {
    await device.restart();
  }
}

export function WavoipQrConnectPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { t, locale } = useI18n();
  const deviceRef = useRef<Device | null>(null);
  const [config, setConfig] = useState<QrPayload | null>(null);
  const [serverStatus, setServerStatus] = useState<StatusPayload | null>(null);
  const [sdkStatus, setSdkStatus] = useState<DeviceStatus | string>("disconnected");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshServerStatus = useCallback(async () => {
    if (!deviceId) return;
    try {
      const statusRes = await api.get<StatusPayload>(`/settings/wavoip/devices/${deviceId}/status`);
      setServerStatus(statusRes);
    } catch {
      /* ignore polling errors */
    }
  }, [deviceId]);

  const loadConfig = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const [qrRes, statusRes] = await Promise.all([
        api.get<QrPayload>(`/settings/wavoip/devices/${deviceId}/qr`),
        api.get<StatusPayload>(`/settings/wavoip/devices/${deviceId}/status`),
      ]);
      setConfig(qrRes);
      setServerStatus(statusRes);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("wavoip.loadError");
      setError(msg === "qr_not_applicable_for_connection_mode" ? t("wavoip.qrModeOnly") : msg);
    } finally {
      setLoading(false);
    }
  }, [deviceId, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!config?.deviceToken) return;

    let cancelled = false;
    const lang = locale.startsWith("pt") ? "pt-BR" : locale.startsWith("es") ? "es" : "en";
    const wavoip = new Wavoip({
      tokens: [config.deviceToken],
      platform: "openconduit",
      language: lang,
    });

    const device = wavoip.getDevices()[0];
    if (!device) return;

    deviceRef.current = device;
    setSdkStatus(device.status);
    setQrCode(device.qrCode ?? null);

    const unsubQr = device.on("qrCodeChanged", (code) => {
      setQrCode(code ?? null);
    });
    const unsubStatus = device.on("statusChanged", (status) => {
      setSdkStatus(status);
      if (status === "open") void refreshServerStatus();
    });

    setWaking(true);
    void ensureDevicePairing(device)
      .catch(() => {
        if (!cancelled) setError(t("wavoip.qrWakeError"));
      })
      .finally(() => {
        if (!cancelled) setWaking(false);
      });

    return () => {
      cancelled = true;
      unsubQr();
      unsubStatus();
      deviceRef.current = null;
    };
  }, [config?.deviceToken, locale, refreshServerStatus, t]);

  useEffect(() => {
    const timer = setInterval(() => void refreshServerStatus(), 5000);
    return () => clearInterval(timer);
  }, [refreshServerStatus]);

  const retryPairing = async () => {
    const device = deviceRef.current;
    if (!device) return;
    setWaking(true);
    setError(null);
    try {
      await device.restart();
    } catch {
      setError(t("wavoip.qrWakeError"));
    } finally {
      setWaking(false);
    }
  };

  const displayStatus = mapSdkStatusToLabel(
    sdkStatus === "open" || serverStatus?.status === "OPEN" ? "OPEN" : sdkStatus || serverStatus?.status || "DISCONNECTED",
  );
  const connected = displayStatus === "OPEN" || sdkStatus === "open";
  const waitingForQr =
    !connected && !qrCode && (waking || ["BUILDING", "RESTARTING", "CONNECTING", "DISCONNECTED"].includes(displayStatus));

  const statusLabelKey = `wavoip.status.${displayStatus}`;
  const statusLabel = t(statusLabelKey) === statusLabelKey ? displayStatus : t(statusLabelKey);

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
        <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", statusBadgeClass(displayStatus))}>
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={() => void retryPairing()}
          disabled={waking || connected}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 disabled:opacity-50 dark:text-brand-400"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", waking && "animate-spin")} />
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
          {(serverStatus?.linkedPhone || config?.linkedPhone) && (
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
              {serverStatus?.linkedPhone ?? config?.linkedPhone}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center">
          {qrCode ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg dark:border-ink-700">
              <QRCodeSVG value={qrCode} size={280} level="M" includeMargin />
            </div>
          ) : config?.qrImageUrl && !waitingForQr ? (
            <img
              src={`${config.qrImageUrl}?t=${Date.now()}`}
              alt={t("wavoip.qrAlt")}
              className="max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-lg dark:border-ink-700"
            />
          ) : (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-8 py-12 text-sm text-slate-500 dark:border-ink-700 dark:text-ink-400">
              {waitingForQr ? (
                <>
                  <Loader2 className="mb-3 h-8 w-8 animate-spin text-brand-500" />
                  {t("wavoip.qrWaiting")}
                </>
              ) : (
                t("wavoip.qrUnavailable")
              )}
            </div>
          )}
          <ol className="mt-8 list-decimal space-y-2 pl-5 text-sm text-slate-600 dark:text-ink-400">
            <li>{t("wavoip.qrStep1")}</li>
            <li>{t("wavoip.qrStep2")}</li>
            <li>{t("wavoip.qrStep3")}</li>
          </ol>
        </div>
      )}

      {config?.webhookUrl && (
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-ink-700 dark:bg-ink-950/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ink-500">
            {t("wavoip.webhookUrlLabel")}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-600 dark:text-ink-300">{config.webhookUrl}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-ink-400">{t("wavoip.webhookPanelHint")}</p>
        </div>
      )}
    </div>
  );
}
