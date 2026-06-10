import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Phone, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { NvoipInsightsPanel } from "@/components/nvoip/NvoipInsightsPanel";
import { NvoipSettingsExtras } from "@/components/nvoip/NvoipSettingsExtras";
import { NvoipTrunksHomologationPanel } from "@/components/nvoip/NvoipTrunksHomologationPanel";
import { NvoipOutboundSetupGuide } from "@/components/nvoip/NvoipOutboundSetupGuide";
import { NvoipPabxPanel } from "@/components/nvoip/NvoipPabxPanel";
import { isLikelyNvoipNumbersipCaller, mapNvoipCallErrorMessage } from "@/lib/mapNvoipCallError";
import { mapNvoipTestErrorMessage } from "@/lib/mapNvoipTestError";
import { useNvoipAuthWidget } from "@/hooks/useNvoipAuthWidget";

const NVOIP_PANEL_URL = "https://painel.nvoip.com.br";

type AccountRow = {
  id: string;
  numbersip: string;
  defaultCaller: string;
  status: string;
  inboxId: string | null;
  inboxName: string | null;
  lastBalance: string | null;
  lastError: string | null;
  otpProvider?: string;
  otpDefaultChannel?: string;
  waInstance?: string | null;
  waDefaultLanguage?: string;
  incomingQueue?: { mode: string; teamId: string | null };
  lowBalanceAlertBrl?: number | null;
  balanceAlertEmails?: string[];
  recordingRetentionDays?: number | null;
  homologationLast?: {
    ranAt: string;
    pass: number;
    fail: number;
    warn: number;
    manual: number;
  } | null;
};

type InboxOption = { id: string; name: string; isDefault: boolean };
type SipUserRow = {
  numbersip: string;
  name: string | null;
  caller: string | null;
  blocked: boolean;
  webphone: boolean | null;
  syncedAt?: string;
};
type ExtensionRow = {
  userId: string;
  name: string;
  email: string;
  caller: string | null;
  nvoipNumbersip: string | null;
};
type DidRow = {
  number: string;
  destination: string | null;
  label: string | null;
};

export function NvoipIntegrationSettings() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nvoipVoice = useNvoipVoiceOptional();
  const voiceEnabled = user?.organizationFeatures?.nvoip_voice ?? false;
  const smsEnabled = user?.organizationFeatures?.nvoip_sms ?? false;
  const otpEnabled = user?.organizationFeatures?.nvoip_otp ?? false;
  const whatsappEnabled = user?.organizationFeatures?.nvoip_whatsapp ?? false;
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [sipUsers, setSipUsers] = useState<SipUserRow[]>([]);
  const [directorySyncedAt, setDirectorySyncedAt] = useState<string | null>(null);
  const [dids, setDids] = useState<DidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [loadingDids, setLoadingDids] = useState(false);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [numbersip, setNumbersip] = useState("");
  const [userToken, setUserToken] = useState("");
  const [napikey, setNapikey] = useState("");
  const [defaultCaller, setDefaultCaller] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [torpedoPhone, setTorpedoPhone] = useState("");
  const [torpedoMessage, setTorpedoMessage] = useState("");
  const [torpedoSending, setTorpedoSending] = useState(false);
  const [torpedoOk, setTorpedoOk] = useState(false);
  const [outboundTestPhone, setOutboundTestPhone] = useState("");
  const [outboundTestCalling, setOutboundTestCalling] = useState(false);
  const [outboundTestOk, setOutboundTestOk] = useState(false);
  const [showTestDialPanel, setShowTestDialPanel] = useState(false);
  const outboundTestPhoneRef = useRef<HTMLInputElement>(null);
  const [otpProvider, setOtpProvider] = useState<"DISABLED" | "NVOIP">("DISABLED");
  const [otpDefaultChannel, setOtpDefaultChannel] = useState<"sms" | "voice" | "email">("sms");
  const [smsTestPhone, setSmsTestPhone] = useState("");
  const [smsTestMessage, setSmsTestMessage] = useState("");
  const [smsTestSending, setSmsTestSending] = useState(false);
  const [otpTestDest, setOtpTestDest] = useState("");
  const [otpTestSending, setOtpTestSending] = useState(false);
  const [otpTestChallengeId, setOtpTestChallengeId] = useState<string | null>(null);
  const [otpWidgetLoading, setOtpWidgetLoading] = useState(false);
  const { openWidget: openNvoipOtpWidget } = useNvoipAuthWidget();
  const [waInstance, setWaInstance] = useState("");
  const [waDefaultLanguage, setWaDefaultLanguage] = useState("pt_BR");
  const [waStatus, setWaStatus] = useState<{
    available: boolean;
    blockedReason: string | null;
    hasMetaInbox: boolean;
  } | null>(null);
  const [waTemplates, setWaTemplates] = useState<
    { id: string; name: string; language: string | null }[]
  >([]);
  const [waTestPhone, setWaTestPhone] = useState("");
  const [waTestTemplateId, setWaTestTemplateId] = useState("");
  const [waTestSending, setWaTestSending] = useState(false);
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false);
  const [incomingQueueMode, setIncomingQueueMode] = useState<"all" | "team">("all");
  const [incomingQueueTeamId, setIncomingQueueTeamId] = useState("");
  const [lowBalanceAlertBrl, setLowBalanceAlertBrl] = useState("5");
  const [balanceAlertEmails, setBalanceAlertEmails] = useState("");
  const [recordingRetentionDays, setRecordingRetentionDays] = useState("");
  const [balanceLow, setBalanceLow] = useState(false);
  const [balanceStale, setBalanceStale] = useState(false);

  const applyExtensionsPayload = (ext: {
    data?: ExtensionRow[];
    sipUsers?: SipUserRow[];
    directorySyncedAt?: string | null;
  }) => {
    setExtensions(ext.data ?? []);
    setSipUsers(ext.sipUsers ?? []);
    setDirectorySyncedAt(ext.directorySyncedAt ?? null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, ib] = await Promise.all([
        api.get<{ account: AccountRow | null }>("/settings/nvoip/account"),
        api.get<InboxOption[]>("/settings/nvoip/inboxes"),
      ]);
      const acc = accRes.account;
      setAccount(acc);
      setInboxes(ib);
      if (voiceEnabled) {
        try {
          const ext = await api.get<{
            data: ExtensionRow[];
            sipUsers?: SipUserRow[];
            directorySyncedAt?: string | null;
          }>("/settings/nvoip/extensions");
          applyExtensionsPayload(ext);
        } catch {
          applyExtensionsPayload({});
        }
      } else {
        applyExtensionsPayload({});
      }
      if (acc) {
        setNumbersip(acc.numbersip);
        setDefaultCaller(acc.defaultCaller);
        setInboxId(acc.inboxId ?? "");
        setOtpProvider((acc.otpProvider === "NVOIP" ? "NVOIP" : "DISABLED") as "DISABLED" | "NVOIP");
        setOtpDefaultChannel(
          (acc.otpDefaultChannel === "voice" || acc.otpDefaultChannel === "email"
            ? acc.otpDefaultChannel
            : "sms") as "sms" | "voice" | "email",
        );
        setWaInstance(acc.waInstance ?? "");
        setWaDefaultLanguage(acc.waDefaultLanguage ?? "pt_BR");
        const qMode = acc.incomingQueue?.mode === "team" ? "team" : "all";
        setIncomingQueueMode(qMode);
        setIncomingQueueTeamId(acc.incomingQueue?.teamId ?? "");
        setLowBalanceAlertBrl(
          acc.lowBalanceAlertBrl != null ? String(acc.lowBalanceAlertBrl) : "5",
        );
        setBalanceAlertEmails((acc.balanceAlertEmails ?? []).join(", "));
        setRecordingRetentionDays(
          acc.recordingRetentionDays != null ? String(acc.recordingRetentionDays) : "",
        );
        setUserToken("");
        setNapikey("");
      }
      if (whatsappEnabled) {
        try {
          const st = await api.get<{
            available: boolean;
            blockedReason: string | null;
            hasMetaInbox: boolean;
          }>("/settings/nvoip/whatsapp/status");
          setWaStatus(st);
        } catch {
          setWaStatus(null);
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, voiceEnabled, whatsappEnabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        numbersip,
        defaultCaller,
        inboxId: inboxId || null,
        otpProvider,
        otpDefaultChannel,
        waInstance: waInstance.trim() || null,
        waDefaultLanguage: waDefaultLanguage.trim() || "pt_BR",
        incomingQueue: {
          mode: incomingQueueMode,
          teamId: incomingQueueMode === "team" ? incomingQueueTeamId || null : null,
        },
        lowBalanceAlertBrl: lowBalanceAlertBrl.trim()
          ? Number(lowBalanceAlertBrl.replace(",", "."))
          : null,
        balanceAlertEmails: balanceAlertEmails.trim() || "",
        recordingRetentionDays: recordingRetentionDays.trim()
          ? Number(recordingRetentionDays)
          : null,
      };
      if (userToken.trim()) body.userToken = userToken.trim();
      if (napikey.trim()) body.napikey = napikey.trim();
      const res = await api.put<{ account: AccountRow }>("/settings/nvoip/account", body);
      setAccount(res.account);
      setUserToken("");
      setNapikey("");
    } catch (e) {
      setError(e instanceof ApiError ? mapNvoipCallErrorMessage(e.message, t) : t("nvoip.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const refreshAccountQuiet = async () => {
    try {
      const accRes = await api.get<{ account: AccountRow | null }>("/settings/nvoip/account");
      const acc = accRes.account;
      setAccount(acc);
      if (acc) {
        setNumbersip(acc.numbersip);
        setDefaultCaller(acc.defaultCaller);
        setInboxId(acc.inboxId ?? "");
      }
    } catch {
      /* ignore */
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    setOutboundTestOk(false);
    setShowTestDialPanel(true);
    try {
      await save();
      const res = await api.post<{ ok: boolean; balance?: string; message?: string }>(
        "/settings/nvoip/account/test",
      );
      if (!res.ok) {
        setError(mapNvoipTestErrorMessage(res.message ?? t("nvoip.testError"), t));
      } else {
        await refreshAccountQuiet();
        void api.post("/settings/nvoip/users/sync").catch(() => {});
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-session-refresh"));
        await nvoipVoice?.refreshSession();
        if (outboundTestPhone.trim()) {
          await placeOutboundTestCall();
        } else {
          window.setTimeout(() => outboundTestPhoneRef.current?.focus(), 50);
        }
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("nvoip.testError");
      setError(mapNvoipTestErrorMessage(msg, t));
    } finally {
      setTesting(false);
    }
  };

  const placeOutboundTestCall = async () => {
    const phone = outboundTestPhone.trim();
    if (!phone || !nvoipVoice) return;
    setOutboundTestCalling(true);
    setError(null);
    setOutboundTestOk(false);
    try {
      const res = await nvoipVoice.startOutboundCall({ phone });
      if (!res.ok) {
        setError(mapNvoipCallErrorMessage(res.message, t));
      } else {
        setOutboundTestOk(true);
      }
    } finally {
      setOutboundTestCalling(false);
    }
  };

  const syncSipUsers = async () => {
    setSyncingUsers(true);
    setError(null);
    try {
      const res = await api.post<{
        ok: boolean;
        sipUsers?: SipUserRow[];
        synced?: number;
      }>("/settings/nvoip/users/sync");
      if (res.sipUsers) setSipUsers(res.sipUsers);
      const latest = res.sipUsers?.[0]?.syncedAt;
      if (latest) setDirectorySyncedAt(latest);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.loadError"));
    } finally {
      setSyncingUsers(false);
    }
  };

  const loadDids = async () => {
    setLoadingDids(true);
    setError(null);
    try {
      const res = await api.get<{ data: DidRow[] }>("/settings/nvoip/dids");
      setDids(res.data ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.loadError"));
      setDids([]);
    } finally {
      setLoadingDids(false);
    }
  };

  const refreshBalance = async () => {
    setRefreshingBalance(true);
    setError(null);
    try {
      const res = await api.get<{
        balance: string;
        balanceLow?: boolean;
        stale?: boolean;
      }>("/settings/nvoip/balance");
      setBalanceLow(!!res.balanceLow);
      setBalanceStale(!!res.stale);
      setAccount((prev) => (prev ? { ...prev, lastBalance: res.balance } : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.testError"));
      setBalanceStale(false);
    } finally {
      setRefreshingBalance(false);
    }
  };

  const saveExtension = async (
    userId: string,
    caller: string,
    nvoipNumbersip: string | null,
  ) => {
    try {
      await api.put(`/settings/nvoip/extensions/${userId}`, {
        caller,
        nvoipNumbersip,
      });
      const ext = await api.get<{
        data: ExtensionRow[];
        sipUsers?: SipUserRow[];
        directorySyncedAt?: string | null;
      }>("/settings/nvoip/extensions");
      applyExtensionsPayload(ext);
      void nvoipVoice?.refreshSession();
    } catch {
      setError(t("nvoip.extensionSaveError"));
      throw new Error("extension_save_failed");
    }
  };

  const linked = account?.status === "CONNECTED";

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-ink-50">{t("nvoip.title")}</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-ink-400">{t("nvoip.subtitle")}</p>
      <a
        href={NVOIP_PANEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        {t("nvoip.panelLink")}
      </a>

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <>
          {account ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-ink-800 dark:bg-ink-950/40">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    account.status === "CONNECTED"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
                  )}
                >
                  {account.status}
                </span>
                {account.lastBalance ? (
                  <span className="text-slate-600 dark:text-ink-300">
                    {t("nvoip.balance")}: <strong>{account.lastBalance}</strong>
                    {balanceStale ? (
                      <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                        ({t("nvoip.balanceStale")})
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {balanceLow ? (
                  <span className="text-xs font-medium text-amber-600">{t("nvoip.balanceLow")}</span>
                ) : null}
                {account.lastError ? (
                  <span className="text-xs text-red-600 dark:text-red-400">{account.lastError}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  disabled={testing}
                  onClick={() => void testConnection()}
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.test")}
                </button>
                {linked ? (
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    disabled={refreshingBalance}
                    onClick={() => void refreshBalance()}
                  >
                    {refreshingBalance ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("nvoip.balanceRefresh")
                    )}
                  </button>
                ) : null}
                <button type="button" className="btn-ghost text-sm" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 max-w-2xl space-y-6">
            <section className="rounded-xl border border-slate-200 p-5 dark:border-ink-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-ink-50">
                {t("nvoip.sectionAccount")}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-ink-400">{t("nvoip.sectionAccountHint")}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium">{t("nvoip.field.numbersip")}</span>
                  <input
                    value={numbersip}
                    onChange={(e) => setNumbersip(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">{t("nvoip.field.userToken")}</span>
                  <input
                    type="password"
                    value={userToken}
                    onChange={(e) => setUserToken(e.target.value)}
                    placeholder={account ? t("nvoip.field.tokenPlaceholder") : undefined}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">{t("nvoip.field.napikey")}</span>
                  <input
                    type="password"
                    value={napikey}
                    onChange={(e) => setNapikey(e.target.value)}
                    placeholder={t("nvoip.field.optional")}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn-primary mt-4 text-sm"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.save")}
              </button>
            </section>

            {voiceEnabled ? (
              <section className="rounded-xl border border-slate-200 p-5 dark:border-ink-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-ink-50">
                  {t("nvoip.sectionVoice")}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-ink-400">{t("nvoip.sectionVoiceHint")}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium">{t("nvoip.field.defaultCaller")}</span>
                    <input
                      value={defaultCaller}
                      onChange={(e) => setDefaultCaller(e.target.value)}
                      placeholder="1049"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                    />
                    {isLikelyNvoipNumbersipCaller(defaultCaller, numbersip) ? (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        {t("nvoip.setup.invalidCallerWarning")}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500 dark:text-ink-400">
                        {t("nvoip.field.defaultCallerHint")}
                      </p>
                    )}
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">{t("nvoip.field.inbox")}</span>
                    <select
                      value={inboxId}
                      onChange={(e) => setInboxId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                    >
                      <option value="">{t("nvoip.field.inboxNone")}</option>
                      {inboxes.map((ib) => (
                        <option key={ib.id} value={ib.id}>
                          {ib.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {(linked || showTestDialPanel) ? (
                  <div className="mt-4 rounded-lg border border-orange-200/80 bg-orange-50/40 p-3 dark:border-orange-900/40 dark:bg-orange-950/20">
                    <p className="text-xs font-medium text-slate-700 dark:text-ink-200">
                      {t("nvoip.outboundTestTitle")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{t("nvoip.outboundTestHint")}</p>
                    {!linked ? (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                        {t("nvoip.outboundTestNeedConnected")}
                      </p>
                    ) : !nvoipVoice?.canPlaceCalls ? (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("nvoip.voice.noCaller")}</p>
                    ) : null}
                    <label className="mt-3 block text-sm">
                      <span className="font-medium">{t("nvoip.outboundTestPhone")}</span>
                      <input
                        ref={outboundTestPhoneRef}
                        value={outboundTestPhone}
                        onChange={(e) => setOutboundTestPhone(e.target.value)}
                        placeholder="11987654321"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-secondary mt-3 text-sm"
                      disabled={
                        outboundTestCalling ||
                        !outboundTestPhone.trim() ||
                        !linked ||
                        !nvoipVoice?.canPlaceCalls
                      }
                      onClick={() => void placeOutboundTestCall()}
                    >
                      {outboundTestCalling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t("nvoip.outboundTestCall")
                      )}
                    </button>
                    {outboundTestOk ? (
                      <p className="mt-2 text-xs text-emerald-600">{t("nvoip.outboundTestSuccess")}</p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="rounded-xl border border-slate-200 p-5 dark:border-ink-800">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium">{t("nvoip.field.defaultCaller")}</span>
                    <input
                      value={defaultCaller}
                      onChange={(e) => setDefaultCaller(e.target.value)}
                      placeholder="1049"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">{t("nvoip.field.inbox")}</span>
                    <select
                      value={inboxId}
                      onChange={(e) => setInboxId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                    >
                      <option value="">{t("nvoip.field.inboxNone")}</option>
                      {inboxes.map((ib) => (
                        <option key={ib.id} value={ib.id}>
                          {ib.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            )}
          </div>

          {(linked && otpEnabled) || whatsappEnabled || (linked && smsEnabled) ? (
            <div className="mt-8 max-w-2xl">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">
                {t("nvoip.sectionChannels")}
              </h3>
            </div>
          ) : null}

          {linked && otpEnabled ? (
            <div className="mt-8 max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">
                {t("nvoip.otp.settingsTitle")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{t("nvoip.otp.settingsHint")}</p>
              <p className="mt-1 text-xs text-slate-500">{t("nvoip.webSdk.settingsHint")}</p>
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.otp.provider")}</span>
                <select
                  value={otpProvider}
                  onChange={(e) => setOtpProvider(e.target.value as "DISABLED" | "NVOIP")}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                >
                  <option value="DISABLED">{t("nvoip.otp.providerDisabled")}</option>
                  <option value="NVOIP">Nvoip</option>
                </select>
              </label>
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.otp.defaultChannel")}</span>
                <select
                  value={otpDefaultChannel}
                  onChange={(e) =>
                    setOtpDefaultChannel(e.target.value as "sms" | "voice" | "email")
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                >
                  <option value="sms">SMS</option>
                  <option value="voice">{t("nvoip.otp.channelVoice")}</option>
                  <option value="email">E-mail</option>
                </select>
              </label>
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.otp.testDestination")}</span>
                <input
                  value={otpTestDest}
                  onChange={(e) => setOtpTestDest(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              <button
                type="button"
                className="btn-secondary mt-3 text-sm"
                disabled={otpTestSending || !otpTestDest.trim() || otpProvider !== "NVOIP"}
                onClick={() => {
                  setOtpTestSending(true);
                  setOtpTestChallengeId(null);
                  void api
                    .post<{ challengeId: string }>("/settings/nvoip/otp/test", {
                      destination: otpTestDest.trim(),
                      channel: otpDefaultChannel,
                    })
                    .then((r) => setOtpTestChallengeId(r.challengeId))
                    .catch((e) =>
                      setError(e instanceof ApiError ? e.message : t("nvoip.otp.sendError")),
                    )
                    .finally(() => setOtpTestSending(false));
                }}
              >
                {otpTestSending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.otp.testSend")}
              </button>
              {otpTestChallengeId ? (
                <p className="mt-2 text-xs text-slate-500">
                  {t("nvoip.otp.testChallenge")}: {otpTestChallengeId}
                </p>
              ) : null}
              <button
                type="button"
                className="btn-secondary mt-3 text-sm"
                disabled={otpWidgetLoading || !otpTestDest.trim() || otpProvider !== "NVOIP"}
                onClick={() => {
                  setOtpWidgetLoading(true);
                  setError(null);
                  void openNvoipOtpWidget({
                    phone: otpTestDest.trim(),
                    purpose: "admin_test",
                    allowPhoneEdit: true,
                    accountLabel: t("nvoip.otp.settingsTitle"),
                  }).catch((e) =>
                    setError(e instanceof Error ? e.message : t("nvoip.otp.sendError")),
                  ).finally(() => setOtpWidgetLoading(false));
                }}
              >
                {otpWidgetLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("nvoip.webSdk.testWidget")
                )}
              </button>
            </div>
          ) : null}

          {whatsappEnabled ? (
            <div className="mt-8 max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">
                {t("nvoip.whatsapp.settingsTitle")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{t("nvoip.whatsapp.settingsHint")}</p>
              {waStatus?.hasMetaInbox ? (
                <p className="mt-2 text-sm text-amber-600">{t("nvoip.whatsapp.blockedMetaInbox")}</p>
              ) : null}
              {waStatus && !waStatus.available && waStatus.blockedReason && !waStatus.hasMetaInbox ? (
                <p className="mt-2 text-sm text-amber-600">
                  {waStatus.blockedReason === "nvoip_not_connected"
                    ? t("nvoip.whatsapp.blockedNotConnected")
                    : waStatus.blockedReason === "nvoip_not_configured"
                      ? t("nvoip.whatsapp.blockedNotConfigured")
                      : waStatus.blockedReason === "wa_instance_missing"
                        ? t("nvoip.whatsapp.blockedNoInstance")
                        : waStatus.blockedReason}
                </p>
              ) : null}
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.whatsapp.instance")}</span>
                <input
                  value={waInstance}
                  onChange={(e) => setWaInstance(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.whatsapp.language")}</span>
                <input
                  value={waDefaultLanguage}
                  onChange={(e) => setWaDefaultLanguage(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              {linked && waStatus?.available ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={waTemplatesLoading}
                      onClick={() => {
                        setWaTemplatesLoading(true);
                        void api
                          .get<{ data: { id: string; name: string; language: string | null }[] }>(
                            "/settings/nvoip/whatsapp/templates",
                          )
                          .then((r) => {
                            setWaTemplates(r.data ?? []);
                            if (r.data?.[0]) setWaTestTemplateId(r.data[0].id);
                          })
                          .catch((e) =>
                            setError(e instanceof ApiError ? e.message : t("nvoip.whatsapp.loadError")),
                          )
                          .finally(() => setWaTemplatesLoading(false));
                      }}
                    >
                      {waTemplatesLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t("nvoip.whatsapp.loadTemplates")
                      )}
                    </button>
                  </div>
                  {waTemplates.length > 0 ? (
                    <label className="mt-3 block text-sm">
                      <span className="font-medium">{t("nvoip.whatsapp.testTemplate")}</span>
                      <select
                        value={waTestTemplateId}
                        onChange={(e) => setWaTestTemplateId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                      >
                        {waTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="mt-3 block text-sm">
                    <span className="font-medium">{t("nvoip.whatsapp.testPhone")}</span>
                    <input
                      value={waTestPhone}
                      onChange={(e) => setWaTestPhone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary mt-3 text-sm"
                    disabled={waTestSending || !waTestPhone.trim() || !waTestTemplateId}
                    onClick={() => {
                      setWaTestSending(true);
                      void api
                        .post("/settings/nvoip/whatsapp/templates/send", {
                          phone: waTestPhone.trim(),
                          idTemplate: waTestTemplateId,
                        })
                        .catch((e) =>
                          setError(e instanceof ApiError ? e.message : t("nvoip.whatsapp.sendError")),
                        )
                        .finally(() => setWaTestSending(false));
                    }}
                  >
                    {waTestSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("nvoip.whatsapp.testSend")
                    )}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {linked && smsEnabled ? (
            <div className="mt-8 max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">
                {t("nvoip.sms.settingsTitle")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{t("nvoip.sms.settingsHint")}</p>
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.sms.testPhone")}</span>
                <input
                  value={smsTestPhone}
                  onChange={(e) => setSmsTestPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              <label className="mt-3 block text-sm">
                <span className="font-medium">{t("nvoip.sms.testMessage")}</span>
                <textarea
                  value={smsTestMessage}
                  onChange={(e) => setSmsTestMessage(e.target.value)}
                  maxLength={160}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              <button
                type="button"
                className="btn-secondary mt-3 text-sm"
                disabled={smsTestSending || !smsTestPhone.trim() || !smsTestMessage.trim()}
                onClick={() => {
                  setSmsTestSending(true);
                  void api
                    .post("/settings/nvoip/sms/test", {
                      phone: smsTestPhone.trim(),
                      message: smsTestMessage.trim(),
                    })
                    .catch((e) =>
                      setError(e instanceof ApiError ? e.message : t("nvoip.sms.sendError")),
                    )
                    .finally(() => setSmsTestSending(false));
                }}
              >
                {smsTestSending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.sms.testSend")}
              </button>
            </div>
          ) : null}

          {voiceEnabled && account ? (
            <NvoipOutboundSetupGuide
              linked={linked}
              defaultCaller={defaultCaller}
              accountNumbersip={account?.numbersip ?? numbersip}
            />
          ) : null}

          {voiceEnabled && account ? (
            <NvoipPabxPanel
              linked={linked}
              accountNumbersip={account?.numbersip ?? numbersip}
              sipUsers={sipUsers}
              directorySyncedAt={directorySyncedAt}
              syncingUsers={syncingUsers}
              onSync={syncSipUsers}
              onSipUsersChange={(users) => {
                setSipUsers(users);
                const latest = users[0]?.syncedAt;
                if (latest) setDirectorySyncedAt(latest);
              }}
              onError={(message) => setError(message)}
            />
          ) : null}

          {voiceEnabled && extensions.length > 0 ? (
            <div className="mt-8 max-w-3xl">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">
                {t("nvoip.extensionsTitle")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{t("nvoip.extensionsHint")}</p>
              <ul className="mt-3 space-y-2">
                {extensions.map((ext) => (
                  <ExtensionAgentRow
                    key={ext.userId}
                    ext={ext}
                    sipUsers={sipUsers}
                    defaultCaller={defaultCaller}
                    pickLabel={t("nvoip.extensionPickRamal")}
                    manualLabel={t("nvoip.extensionPickManual")}
                    saveLabel={t("nvoip.extensionSave")}
                    onSave={saveExtension}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {linked ? (
            <div className="mt-8 max-w-3xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">
                    {t("nvoip.didsTitle")}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">{t("nvoip.didsHint")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={loadingDids}
                    onClick={() => void loadDids()}
                  >
                    {loadingDids ? (
                      <>
                        <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                        {t("nvoip.didsLoading")}
                      </>
                    ) : (
                      t("nvoip.didsLoad")
                    )}
                  </button>
                  <a
                    href={NVOIP_PANEL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost inline-flex items-center gap-1 text-sm"
                  >
                    {t("nvoip.didsPanelLink")}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
              {dids.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("nvoip.didsEmpty")}</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-ink-800">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-ink-800 dark:bg-ink-900">
                      <tr>
                        <th className="px-3 py-2">{t("nvoip.didsColNumber")}</th>
                        <th className="px-3 py-2">{t("nvoip.didsColDestination")}</th>
                        <th className="px-3 py-2">{t("nvoip.didsColLabel")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dids.map((d) => (
                        <tr key={d.number} className="border-t border-slate-100 dark:border-ink-800">
                          <td className="px-3 py-2 font-mono">{d.number}</td>
                          <td className="px-3 py-2">{d.destination ?? "—"}</td>
                          <td className="px-3 py-2">{d.label ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      {account?.status === "CONNECTED" && voiceEnabled ? (
        <div className="mt-8 max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("nvoip.torpedoTitle")}</h3>
          <p className="mt-1 text-xs text-slate-500">{t("nvoip.torpedoHint")}</p>
          <label className="mt-3 block text-sm">
            <span className="font-medium">{t("nvoip.torpedoPhone")}</span>
            <input
              value={torpedoPhone}
              onChange={(e) => setTorpedoPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="font-medium">{t("nvoip.torpedoMessage")}</span>
            <textarea
              value={torpedoMessage}
              onChange={(e) => setTorpedoMessage(e.target.value)}
              rows={3}
              maxLength={900}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
            />
          </label>
          <button
            type="button"
            className="btn-secondary mt-3 text-sm"
            disabled={torpedoSending || !torpedoPhone.trim() || !torpedoMessage.trim()}
            onClick={() => {
              setTorpedoSending(true);
              setTorpedoOk(false);
              void api
                .post("/settings/nvoip/torpedo/test", {
                  phone: torpedoPhone.trim(),
                  message: torpedoMessage.trim(),
                  caller: defaultCaller || undefined,
                })
                .then(() => setTorpedoOk(true))
                .catch((e) =>
                  setError(e instanceof ApiError ? e.message : t("nvoip.testError")),
                )
                .finally(() => setTorpedoSending(false));
            }}
          >
            {torpedoSending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.torpedoSend")}
          </button>
          {torpedoOk ? <p className="mt-2 text-xs text-emerald-600">{t("nvoip.torpedoSuccess")}</p> : null}
        </div>
      ) : null}

      <NvoipSettingsExtras
        voiceEnabled={voiceEnabled}
        linked={!!linked}
        incomingQueueMode={incomingQueueMode}
        incomingQueueTeamId={incomingQueueTeamId}
        lowBalanceAlertBrl={lowBalanceAlertBrl}
        onRoutingChange={(patch) => {
          if (patch.incomingQueueMode) setIncomingQueueMode(patch.incomingQueueMode);
          if (patch.incomingQueueTeamId !== undefined) setIncomingQueueTeamId(patch.incomingQueueTeamId);
          if (patch.lowBalanceAlertBrl !== undefined) setLowBalanceAlertBrl(patch.lowBalanceAlertBrl);
        }}
        dids={dids}
        onDidsReload={() => void loadDids()}
      />

      <NvoipTrunksHomologationPanel
        voiceEnabled={voiceEnabled}
        linked={!!linked}
        balanceAlertEmails={balanceAlertEmails}
        recordingRetentionDays={recordingRetentionDays}
        onPolicyChange={(patch) => {
          if (patch.balanceAlertEmails !== undefined) setBalanceAlertEmails(patch.balanceAlertEmails);
          if (patch.recordingRetentionDays !== undefined) {
            setRecordingRetentionDays(patch.recordingRetentionDays);
          }
        }}
        homologationLast={account?.homologationLast ?? null}
        onHomologationComplete={(result) =>
          setAccount((prev) =>
            prev
              ? {
                  ...prev,
                  homologationLast: { ranAt: result.ranAt, ...result.summary },
                }
              : prev,
          )
        }
      />

      {account?.status === "CONNECTED" && voiceEnabled ? (
        <NvoipInsightsPanel connected />
      ) : null}

      <p className="mt-6 flex items-start gap-2 text-xs text-slate-500 dark:text-ink-500">
        <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("nvoip.messagingNote")}
      </p>
    </div>
  );
}

function ExtensionAgentRow({
  ext,
  sipUsers,
  defaultCaller,
  pickLabel,
  manualLabel,
  saveLabel,
  onSave,
}: {
  ext: ExtensionRow;
  sipUsers: SipUserRow[];
  defaultCaller: string;
  pickLabel: string;
  manualLabel: string;
  saveLabel: string;
  onSave: (userId: string, caller: string, nvoipNumbersip: string | null) => Promise<void>;
}) {
  const [caller, setCaller] = useState(ext.caller ?? "");
  const [pick, setPick] = useState(ext.nvoipNumbersip ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCaller(ext.caller ?? "");
    setPick(ext.nvoipNumbersip ?? "");
    setSaved(false);
  }, [ext.caller, ext.nvoipNumbersip]);

  const dirty =
    caller.trim() !== (ext.caller ?? "").trim() ||
    (pick || null) !== (ext.nvoipNumbersip || null);

  const onPickChange = (numbersip: string) => {
    setPick(numbersip);
    setSaved(false);
    if (!numbersip) return;
    const su = sipUsers.find((s) => s.numbersip === numbersip);
    if (su?.caller?.trim()) setCaller(su.caller.trim());
  };

  const handleSave = async () => {
    const v = caller.trim();
    if (!v) return;
    setSaving(true);
    setSaved(false);
    try {
      await onSave(ext.userId, v, pick.trim() || null);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-800">
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{ext.name}</span>
        <span className="block text-xs text-slate-500">{ext.email}</span>
      </span>
      {sipUsers.length > 0 ? (
        <select
          value={pick}
          onChange={(e) => onPickChange(e.target.value)}
          className="max-w-[12rem] rounded border border-slate-200 px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-950"
          title={pickLabel}
        >
          <option value="">{pickLabel}</option>
          {sipUsers.map((su) => (
            <option key={su.numbersip} value={su.numbersip}>
              {su.name || su.numbersip}
              {su.caller ? ` (${su.caller})` : ""}
            </option>
          ))}
        </select>
      ) : null}
      <input
        value={caller}
        onChange={(e) => {
          setCaller(e.target.value);
          setSaved(false);
        }}
        placeholder={defaultCaller || "1049"}
        title={manualLabel}
        className="w-24 rounded border border-slate-200 px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-950"
      />
      <button
        type="button"
        className="btn-secondary px-2 py-1 text-xs"
        disabled={saving || !caller.trim() || !dirty}
        onClick={() => void handleSave()}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveLabel}
      </button>
      {saved && !dirty ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span>
      ) : null}
    </li>
  );
}
