import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type ConversationMessagesPaginationConfig = {
  enabled: boolean;
  pageSize: number;
};

export function SuperAdminConversationMessagesPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ConversationMessagesPaginationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<ConversationMessagesPaginationConfig>(
        "/super/conversation-messages-pagination",
      );
      setConfig(data);
    } catch {
      setError(t("superAdmin.conversationMessagesPagination.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await api.put<ConversationMessagesPaginationConfig>(
        "/super/conversation-messages-pagination",
        config,
      );
      setConfig(saved);
      setMessage(t("superAdmin.conversationMessagesPagination.saved"));
    } catch {
      setError(t("superAdmin.conversationMessagesPagination.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <section className="card-surface p-6">
        <p className="text-sm text-ink-500">{t("common.loading")}</p>
      </section>
    );
  }

  return (
    <section className="card-surface space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-ink-900">{t("superAdmin.conversationMessagesPagination.title")}</h2>
        <p className="mt-1 text-sm text-ink-600">{t("superAdmin.conversationMessagesPagination.subtitle")}</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p> : null}

      <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
        {t("superAdmin.conversationMessagesPagination.hint")}
      </p>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig((current) => (current ? { ...current, enabled: e.target.checked } : current))}
        />
        {t("superAdmin.conversationMessagesPagination.enabled")}
      </label>

      <div className="max-w-xs">
        <label className="block text-xs font-medium text-ink-600">
          {t("superAdmin.conversationMessagesPagination.pageSize")}
        </label>
        <input
          type="number"
          min={10}
          max={200}
          value={config.pageSize}
          disabled={!config.enabled}
          onChange={(e) =>
            setConfig((current) =>
              current ? { ...current, pageSize: Number(e.target.value) || current.pageSize } : current,
            )
          }
          className="input-field mt-1"
        />
        <p className="mt-1 text-xs text-ink-500">{t("superAdmin.conversationMessagesPagination.pageSizeHint")}</p>
      </div>

      <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? t("common.loading") : t("common.save")}
      </button>
    </section>
  );
}
