import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type RateLimitKeyBy = "organization" | "api_token" | "user" | "ip";

type RateLimitRule = {
  enabled: boolean;
  max: number;
  timeWindowSeconds: number;
  keyBy: RateLimitKeyBy;
};

type CatalogEntry = {
  id: "send_template" | "messages_post" | "templates_list";
  method: string;
  path: string;
  titlePt: string;
  descriptionPt: string;
  recommendedKeyBy: RateLimitKeyBy;
  defaultRule: RateLimitRule;
};

type ApiRateLimitAdminConfig = {
  endpoints: Record<CatalogEntry["id"], RateLimitRule>;
  catalog: CatalogEntry[];
};

const KEY_BY_OPTIONS: RateLimitKeyBy[] = ["organization", "api_token", "user", "ip"];

export function SuperAdminApiRateLimitPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ApiRateLimitAdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<ApiRateLimitAdminConfig>("/super/api-endpoint-rate-limits");
      setConfig(data);
    } catch {
      setError(t("superAdmin.apiRateLimit.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRule = (id: CatalogEntry["id"], patch: Partial<RateLimitRule>) => {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        endpoints: {
          ...current.endpoints,
          [id]: { ...current.endpoints[id], ...patch },
        },
      };
    });
  };

  const resetToDefault = (entry: CatalogEntry) => {
    updateRule(entry.id, { ...entry.defaultRule });
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await api.put<ApiRateLimitAdminConfig>("/super/api-endpoint-rate-limits", {
        endpoints: config.endpoints,
      });
      setConfig(saved);
      setMessage(t("superAdmin.apiRateLimit.saved"));
    } catch {
      setError(t("superAdmin.apiRateLimit.saveError"));
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
        <h2 className="font-semibold text-ink-900">{t("superAdmin.apiRateLimit.title")}</h2>
        <p className="mt-1 text-sm text-ink-600">{t("superAdmin.apiRateLimit.subtitle")}</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p> : null}

      <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
        {t("superAdmin.apiRateLimit.globalHint")}
      </p>

      <div className="space-y-4">
        {config.catalog.map((entry) => {
          const rule = config.endpoints[entry.id];
          return (
            <div key={entry.id} className="space-y-3 rounded-xl border border-ink-200 p-4 dark:border-ink-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink-900 dark:text-ink-100">{entry.titlePt}</p>
                  <p className="font-mono text-xs text-ink-500">
                    {entry.method} {entry.path}
                  </p>
                  <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">{entry.descriptionPt}</p>
                </div>
                <button type="button" className="btn-ghost text-xs" onClick={() => resetToDefault(entry)}>
                  {t("superAdmin.apiRateLimit.resetDefault")}
                </button>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => updateRule(entry.id, { enabled: e.target.checked })}
                />
                {t("superAdmin.apiRateLimit.enabled")}
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.apiRateLimit.maxRequests")}</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={rule.max}
                    disabled={!rule.enabled}
                    onChange={(e) => updateRule(entry.id, { max: Number(e.target.value) || 1 })}
                    className="input-field mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.apiRateLimit.windowSeconds")}</label>
                  <input
                    type="number"
                    min={1}
                    max={86400}
                    value={rule.timeWindowSeconds}
                    disabled={!rule.enabled}
                    onChange={(e) => updateRule(entry.id, { timeWindowSeconds: Number(e.target.value) || 1 })}
                    className="input-field mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.apiRateLimit.keyBy")}</label>
                  <select
                    value={rule.keyBy}
                    disabled={!rule.enabled}
                    onChange={(e) => updateRule(entry.id, { keyBy: e.target.value as RateLimitKeyBy })}
                    className="input-field mt-1"
                  >
                    {KEY_BY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {t(`superAdmin.apiRateLimit.keyByOption.${opt}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-xs text-ink-500">
                {t("superAdmin.apiRateLimit.preview")
                  .replace("{max}", String(rule.max))
                  .replace("{seconds}", String(rule.timeWindowSeconds))}
              </p>
            </div>
          );
        })}
      </div>

      <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? t("common.loading") : t("common.save")}
      </button>
    </section>
  );
}
