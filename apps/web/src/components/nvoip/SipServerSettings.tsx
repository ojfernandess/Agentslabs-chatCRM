import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { settingsInput, settingsLabel, settingsSubtitle, settingsTitle } from "@/components/settings/settingsUi";

type SipServer = {
  sipProvider: "nvoip" | "sip";
  configurable: boolean;
  sipDomain: string;
  wssUrl: string;
};

export function SipServerSettings() {
  const { t } = useI18n();
  const [sipDomain, setSipDomain] = useState("");
  const [wssUrl, setWssUrl] = useState("");
  const [provider, setProvider] = useState<SipServer["sipProvider"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const server = await api.get<SipServer>("/sip/server");
      setSipDomain(server.sipDomain ?? "");
      setWssUrl(server.wssUrl ?? "");
      setProvider(server.sipProvider);
    } catch {
      setError(t("nvoip.sip.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!sipDomain.trim() || !wssUrl.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const savedServer = await api.put<SipServer>("/sip/server", {
        sipDomain: sipDomain.trim(),
        wssUrl: wssUrl.trim(),
      });
      setSipDomain(savedServer.sipDomain ?? "");
      setWssUrl(savedServer.wssUrl ?? "");
      setProvider(savedServer.sipProvider);
      setSaved(true);
      window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-refresh"));
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError(t("nvoip.sip.serverSaveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className={settingsTitle}>{t("nvoip.sip.serverTitle")}</h2>
      <p className={`mt-1 ${settingsSubtitle}`}>{t("nvoip.sip.serverHint")}</p>
      {provider === "nvoip" ? (
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">{t("nvoip.sip.serverNvoipActive")}</p>
      ) : null}
      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </p>
      ) : (
        <div className="mt-4 max-w-xl space-y-3">
          <label className={settingsLabel}>
            {t("nvoip.sip.fieldDomain")}
            <input
              value={sipDomain}
              onChange={(e) => setSipDomain(e.target.value)}
              placeholder="app.nvoip.com.br"
              className={settingsInput}
            />
          </label>
          <label className={settingsLabel}>
            {t("nvoip.sip.fieldWss")}
            <input
              value={wssUrl}
              onChange={(e) => setWssUrl(e.target.value)}
              placeholder="wss://servidor:8089/ws"
              className={settingsInput}
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            disabled={saving || !sipDomain.trim() || !wssUrl.trim()}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saved ? t("nvoip.sip.saved") : t("nvoip.sip.saveServer")}
          </button>
        </div>
      )}
    </div>
  );
}
