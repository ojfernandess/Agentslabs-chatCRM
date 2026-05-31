import { useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type BridgeStatus = {
  syncedAt: string | null;
  provisionedAt: string | null;
  sourceInboxId: string | null;
  evolutionTokenSetAt: string | null;
  lastValidation: {
    ok: boolean;
    connectionState: string | null;
    message: string | null;
    at: string | null;
  } | null;
};

type DeviceBridgeProps = {
  deviceId: string;
  connectionMode: string;
  inboxId: string | null;
  inboxName: string | null;
  bridgeStatus: BridgeStatus;
  onUpdated: () => Promise<void>;
};

type ProvisionStep = { id: string; ok: boolean; message: string };

function bridgeErrorMessage(t: (k: string) => string, code: string): string {
  const key = `wavoip.bridge.errors.${code}`;
  const translated = t(key);
  return translated === key ? code : translated;
}

export function WavoipEvolutionBridgePanel({
  deviceId,
  connectionMode,
  inboxId,
  inboxName,
  bridgeStatus,
  onUpdated,
}: DeviceBridgeProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProvisionStep[] | null>(null);

  if (connectionMode !== "EXTERNAL_EVOLUTION") return null;

  const run = async (action: "sync" | "validate" | "provision") => {
    setBusy(action);
    setLocalError(null);
    setSteps(null);
    try {
      if (action === "sync") {
        await api.post(`/settings/wavoip/devices/${deviceId}/bridge/sync-from-inbox`);
      } else if (action === "validate") {
        await api.post(`/settings/wavoip/devices/${deviceId}/bridge/validate`);
      } else {
        const res = await api.post<{ ok: boolean; steps: ProvisionStep[] }>(
          `/settings/wavoip/devices/${deviceId}/bridge/provision`,
          { syncFromInbox: true },
        );
        setSteps(res.steps ?? []);
      }
      await onUpdated();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? bridgeErrorMessage(t, e.message)
          : t("wavoip.bridge.actionError");
      setLocalError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-brand-200/80 bg-brand-50/50 p-4 dark:border-brand-900/40 dark:bg-brand-950/20">
      <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">{t("wavoip.bridge.title")}</p>
      <p className="mt-1 text-xs text-brand-800/90 dark:text-brand-200/90">{t("wavoip.bridge.subtitle")}</p>

      {!inboxId ? (
        <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">{t("wavoip.bridge.inboxRequired")}</p>
      ) : (
        <p className="mt-2 text-xs text-slate-600 dark:text-ink-400">
          {t("wavoip.bridge.linkedInbox")}: {inboxName ?? inboxId}
        </p>
      )}

      <dl className="mt-3 grid gap-1 text-[11px] text-slate-600 dark:text-ink-400 sm:grid-cols-2">
        {bridgeStatus.syncedAt ? (
          <div>
            <dt className="font-medium">{t("wavoip.bridge.syncedAt")}</dt>
            <dd>{new Date(bridgeStatus.syncedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        {bridgeStatus.evolutionTokenSetAt ? (
          <div>
            <dt className="font-medium">{t("wavoip.bridge.tokenSetAt")}</dt>
            <dd>{new Date(bridgeStatus.evolutionTokenSetAt).toLocaleString()}</dd>
          </div>
        ) : null}
        {bridgeStatus.lastValidation ? (
          <div className="sm:col-span-2">
            <dt className="font-medium">{t("wavoip.bridge.lastValidation")}</dt>
            <dd className={clsx(bridgeStatus.lastValidation.ok ? "text-emerald-700" : "text-amber-800")}>
              {bridgeStatus.lastValidation.connectionState ?? bridgeStatus.lastValidation.message ?? "—"}
              {bridgeStatus.lastValidation.at
                ? ` · ${new Date(bridgeStatus.lastValidation.at).toLocaleString()}`
                : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!inboxId || busy != null}
          onClick={() => void run("sync")}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-800 dark:bg-ink-900 dark:text-brand-100"
        >
          {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("wavoip.bridge.syncFromInbox")}
        </button>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void run("validate")}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-900"
        >
          {busy === "validate" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {t("wavoip.bridge.validate")}
        </button>
        <button
          type="button"
          disabled={!inboxId || busy != null}
          onClick={() => void run("provision")}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy === "provision" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {t("wavoip.bridge.provision")}
        </button>
      </div>

      <p className="mt-3 text-[11px] text-slate-500 dark:text-ink-500">{t("wavoip.bridge.panelNote")}</p>

      {localError ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{localError}</p>
      ) : null}

      {steps && steps.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {steps.map((step) => (
            <li
              key={step.id}
              className={clsx(
                "flex items-start gap-2",
                step.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200",
              )}
            >
              <span>{step.ok ? "✓" : "•"}</span>
              <span>
                {t(`wavoip.bridge.steps.${step.id}`)}: {bridgeErrorMessage(t, step.message)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
