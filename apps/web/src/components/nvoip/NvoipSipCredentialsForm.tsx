import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";

type SipServer = {
  sipProvider: "nvoip" | "sip";
  configurable: boolean;
  sipDomain: string;
  wssUrl: string;
};

export function NvoipSipCredentialsForm() {
  const { t } = useI18n();
  const { user } = useAuth();
  const enabled = user?.organizationFeatures?.nvoip_embedded_sip ?? false;
  const canConfigureServer = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [sipUser, setSipUser] = useState("");
  const [sipPassword, setSipPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [server, setServer] = useState<SipServer | null>(null);
  const [sipDomain, setSipDomain] = useState("");
  const [wssUrl, setWssUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverSaved, setServerSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [creds, srv] = await Promise.all([
        api.get<{
          sipUser: string;
          sipPassword: string;
          displayName?: string | null;
        }>("/sip/credentials").catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
        api.get<SipServer>("/sip/server"),
      ]);
      if (creds) {
        setSipUser(creds.sipUser ?? "");
        setSipPassword(creds.sipPassword ?? "");
        setDisplayName(creds.displayName ?? "");
      }
      setServer(srv);
      setSipDomain(srv.sipDomain ?? "");
      setWssUrl(srv.wssUrl ?? "");
    } catch {
      setError(t("nvoip.sip.loadError"));
    } finally {
      setLoading(false);
    }
  }, [enabled, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled) return null;

  const handleSaveServer = async () => {
    if (!sipDomain.trim() || !wssUrl.trim()) return;
    setSavingServer(true);
    setError(null);
    setServerSaved(false);
    try {
      const saved = await api.put<SipServer>("/sip/server", {
        sipDomain: sipDomain.trim(),
        wssUrl: wssUrl.trim(),
      });
      setServer(saved);
      setServerSaved(true);
      window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-refresh"));
      setTimeout(() => setServerSaved(false), 3000);
    } catch {
      setError(t("nvoip.sip.serverSaveError"));
    } finally {
      setSavingServer(false);
    }
  };

  const handleSave = async () => {
    if (!sipUser.trim() || !sipPassword.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put("/sip/credentials", {
        sipUser: sipUser.trim(),
        sipPassword,
        displayName: displayName.trim() || null,
      });
      setSaved(true);
      window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-refresh"));
      window.dispatchEvent(new CustomEvent("openconduit:nvoip-session-refresh"));
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      if (e instanceof ApiError && e.message === "sip_trunk_use_click_to_call") {
        setError(t("nvoip.sip.trunkUseClickToCall"));
      } else {
        setError(t("nvoip.sip.saveError"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-5 dark:border-ink-700 dark:bg-ink-900">
      <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{t("nvoip.sip.settingsTitle")}</h2>
      <p className="mt-1 text-xs text-ink-500">
        {server?.sipProvider === "sip" ? t("nvoip.sip.genericHint") : t("nvoip.sip.settingsHint")}
      </p>
      {canConfigureServer && server?.configurable ? (
        <div className="mt-4 space-y-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <p className="text-xs font-medium text-ink-800 dark:text-ink-100">{t("nvoip.sip.serverTitle")}</p>
          <p className="text-xs text-ink-500">{t("nvoip.sip.serverHint")}</p>
          <label className="block text-xs">
            {t("nvoip.sip.fieldDomain")}
            <input
              value={sipDomain}
              onChange={(e) => setSipDomain(e.target.value)}
              placeholder="app.nvoip.com.br"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
          </label>
          <label className="block text-xs">
            {t("nvoip.sip.fieldWss")}
            <input
              value={wssUrl}
              onChange={(e) => setWssUrl(e.target.value)}
              placeholder="wss://servidor:8089/ws"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
          </label>
          <button
            type="button"
            disabled={savingServer || !sipDomain.trim() || !wssUrl.trim()}
            onClick={() => void handleSaveServer()}
            className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-ink-600"
          >
            {savingServer ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {serverSaved ? t("nvoip.sip.saved") : t("nvoip.sip.saveServer")}
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-xs">
            {t("nvoip.sip.fieldUser")}
            <input
              value={sipUser}
              onChange={(e) => setSipUser(e.target.value)}
              placeholder="1049"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
          </label>
          <label className="block text-xs">
            {t("nvoip.sip.fieldPassword")}
            <input
              type="password"
              value={sipPassword}
              onChange={(e) => setSipPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
          </label>
          <label className="block text-xs">
            {t("nvoip.sip.fieldDisplayName")}
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
            />
          </label>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button
            type="button"
            disabled={saving || !sipUser.trim() || !sipPassword.trim()}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saved ? t("nvoip.sip.saved") : t("common.save")}
          </button>
        </div>
      )}
    </section>
  );
}
