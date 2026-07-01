import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type PabxMode = "platform_webphone" | "external_pabx_trunk";

type TrunkInfo = {
  mode: PabxMode;
  sipServer: string;
  sipPort: number;
  transport: string;
  sipUser: string;
  sipPassword: string | null;
  sipPasswordConfigured: boolean;
  webhookUrl: string | null;
  webphonePanelUrl: string;
  nvoipPanelUrl: string;
  capabilities: {
    clickToCall: boolean;
    inboundHistorySync: boolean;
    inboundWebhooks: boolean;
    browserWebphone: boolean;
    externalPabxTrunk: boolean;
    webrtcInCrm: boolean;
  };
  webphoneExtensions: { numbersip: string; caller: string | null; name: string | null }[];
  notes: {
    platform: string;
    external: string;
    webrtcLimit: string;
  };
};

type Props = {
  linked: boolean;
  accountNumbersip: string;
  onError: (message: string) => void;
  onConfigSaved?: () => void;
};

function CopyField({
  label,
  value,
  fieldKey,
  copiedKey,
  onCopy,
}: {
  label: string;
  value: string;
  fieldKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1">
        <code className="truncate rounded bg-slate-100 px-2 py-1 text-xs dark:bg-ink-900">{value}</code>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"
          title={label}
          onClick={() => void onCopy(fieldKey, value)}
        >
          {copiedKey === fieldKey ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </dd>
    </div>
  );
}

export function NvoipPabxTrunkPanel({ linked, accountNumbersip, onError, onConfigSaved }: Props) {
  const { t } = useI18n();
  const [trunk, setTrunk] = useState<TrunkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [mode, setMode] = useState<PabxMode>("platform_webphone");
  const [sipPassword, setSipPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ trunk: TrunkInfo; connected?: boolean }>("/settings/nvoip/pabx/trunk");
      setTrunk(res.trunk);
      setMode(res.trunk.mode);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("nvoip.pabxTrunk.loadError"));
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    void load();
  }, [load, accountNumbersip]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const revealPassword = async () => {
    if (revealedPassword) {
      setShowPassword((v) => !v);
      return;
    }
    try {
      const res = await api.get<{ sipPassword: string | null }>("/settings/nvoip/pabx/trunk/credentials");
      setRevealedPassword(res.sipPassword ?? "");
      setShowPassword(true);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("nvoip.pabxTrunk.loadError"));
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { mode };
      if (sipPassword.trim()) body.trunkSipPassword = sipPassword.trim();
      const res = await api.put<{ ok: boolean; trunk: TrunkInfo }>("/settings/nvoip/pabx/config", body);
      setTrunk(res.trunk);
      setSipPassword("");
      setRevealedPassword(null);
      setShowPassword(false);
      onConfigSaved?.();
      window.dispatchEvent(new Event("openconduit:nvoip-session-refresh"));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("nvoip.pabxTrunk.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const syncInbound = async () => {
    setSyncing(true);
    try {
      const res = await api.post<{ ok: boolean; processed: number; created: number; screenPops: number }>(
        "/settings/nvoip/pabx/sync-inbound",
      );
      setSyncMessage(
        t("nvoip.pabxTrunk.syncResult")
          .replace("{created}", String(res.created))
          .replace("{screenPops}", String(res.screenPops)),
      );
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("nvoip.pabxTrunk.syncError"));
    } finally {
      setSyncing(false);
    }
  };

  if (!accountNumbersip.trim()) return null;

  const sipUser = trunk?.sipUser ?? accountNumbersip;
  const sipServer = trunk?.sipServer ?? "app.nvoip.com.br";
  const displayPassword =
    showPassword && revealedPassword
      ? revealedPassword
      : trunk?.sipPasswordConfigured
        ? "••••••••"
        : t("nvoip.pabxTrunk.passwordNotStored");

  const modeSteps =
    mode === "platform_webphone"
      ? [
          t("nvoip.pabxTrunk.platformStep1"),
          t("nvoip.pabxTrunk.platformStep2"),
          t("nvoip.pabxTrunk.platformStep3"),
          t("nvoip.pabxTrunk.platformStep4"),
        ]
      : [
          t("nvoip.pabxTrunk.externalStep1"),
          t("nvoip.pabxTrunk.externalStep2"),
          t("nvoip.pabxTrunk.externalStep3"),
          t("nvoip.pabxTrunk.externalStep4"),
        ];

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-ink-100">
            {t("nvoip.pabxTrunk.title")}
          </h4>
          <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-ink-400">
            {t("nvoip.pabxTrunk.subtitle")}
          </p>
        </div>
        <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      <p className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        {trunk?.notes.webrtcLimit ?? t("nvoip.pabxTrunk.webrtcLimit")}
      </p>

      {!linked ? (
        <p className="mt-3 rounded-lg border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
          {t("nvoip.pabxTrunk.needConnected")}
        </p>
      ) : null}

      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-medium text-slate-700 dark:text-ink-300">
          {t("nvoip.pabxTrunk.modeLabel")}
        </legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-ink-700">
          <input
            type="radio"
            name="pabxMode"
            checked={mode === "platform_webphone"}
            onChange={() => setMode("platform_webphone")}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800 dark:text-ink-200">
              {t("nvoip.pabxTrunk.modePlatform")}
            </span>
            <span className="text-xs text-slate-500">{t("nvoip.pabxTrunk.modePlatformHint")}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-ink-700">
          <input
            type="radio"
            name="pabxMode"
            checked={mode === "external_pabx_trunk"}
            onChange={() => setMode("external_pabx_trunk")}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800 dark:text-ink-200">
              {t("nvoip.pabxTrunk.modeExternal")}
            </span>
            <span className="text-xs text-slate-500">{t("nvoip.pabxTrunk.modeExternalHint")}</span>
          </span>
        </label>
      </fieldset>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <CopyField
          label={t("nvoip.pabxTrunk.sipUser")}
          value={sipUser}
          fieldKey="sipUser"
          copiedKey={copiedKey}
          onCopy={copyText}
        />
        <CopyField
          label={t("nvoip.pabxTrunk.sipServer")}
          value={sipServer}
          fieldKey="sipServer"
          copiedKey={copiedKey}
          onCopy={copyText}
        />
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-slate-500">{t("nvoip.pabxTrunk.sipPassword")}</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2">
            <code className="rounded bg-slate-100 px-2 py-1 text-xs dark:bg-ink-900">{displayPassword}</code>
            {trunk?.sipPasswordConfigured ? (
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void revealPassword()}>
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            ) : null}
            {showPassword && revealedPassword ? (
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => void copyText("sipPassword", revealedPassword)}
              >
                {copiedKey === "sipPassword" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </dd>
          <p className="mt-1 text-[11px] text-slate-500">{t("nvoip.pabxTrunk.passwordHint")}</p>
        </div>
      </dl>

      <label className="mt-3 block text-xs">
        <span className="font-medium text-slate-700 dark:text-ink-300">{t("nvoip.pabxTrunk.storePassword")}</span>
        <input
          type="password"
          value={sipPassword}
          onChange={(e) => setSipPassword(e.target.value)}
          placeholder={t("nvoip.pabxTrunk.storePasswordPlaceholder")}
          className="mt-1 w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
        />
      </label>

      {trunk?.webhookUrl ? (
        <div className="mt-3">
          <CopyField
            label={t("nvoip.pabxTrunk.webhookUrl")}
            value={trunk.webhookUrl}
            fieldKey="webhook"
            copiedKey={copiedKey}
            onCopy={copyText}
          />
          <p className="mt-1 text-[11px] text-slate-500">{t("nvoip.pabxTrunk.webhookHint")}</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-sm" disabled={saving} onClick={() => void saveConfig()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.pabxTrunk.saveMode")}
        </button>
        <button type="button" className="btn-secondary text-sm" disabled={syncing || !linked} onClick={() => void syncInbound()}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.pabxTrunk.syncInbound")}
        </button>
        <a
          href={trunk?.webphonePanelUrl ?? "https://painel.nvoip.com.br/webphone"}
          target="_blank"
          rel="noopener noreferrer"
          className={clsx("btn-secondary inline-flex items-center gap-1 text-sm")}
        >
          {t("nvoip.pabxTrunk.openWebphone")}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {syncMessage ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{syncMessage}</p>
      ) : null}

      <ol className="mt-4 list-decimal space-y-1.5 pl-4 text-xs text-slate-700 dark:text-ink-300">
        {modeSteps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {mode === "platform_webphone" ? (
        <p className="mt-3 rounded-lg border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200">
          {t("nvoip.pabxTrunk.platformEmbeddedNote")}
        </p>
      ) : null}

      {trunk && trunk.webphoneExtensions.length > 0 ? (
        <p className="mt-3 text-xs text-violet-800 dark:text-violet-200">
          {t("nvoip.pabxTrunk.webphoneExtensions")}:{" "}
          {trunk.webphoneExtensions.map((u) => u.caller?.trim() || u.numbersip).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
