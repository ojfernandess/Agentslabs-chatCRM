import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { invalidateHelpConfigCache } from "@/lib/help/useHelpConfig";

export type HelpCenterAdminConfig = {
  support: {
    enabled: boolean;
    phone: string;
    whatsappMessage: string;
    title: string;
    description: string;
  };
  guide: {
    enabled: boolean;
    title: string;
    description: string;
  };
};

const DEFAULT: HelpCenterAdminConfig = {
  support: {
    enabled: true,
    phone: "",
    whatsappMessage: "Olá! Sou cliente e preciso de ajuda com a plataforma.",
    title: "Falar com o Suporte",
    description: "Nosso time de suporte vai te ajudar com qualquer problema ou dúvida na plataforma.",
  },
  guide: {
    enabled: true,
    title: "Central de Ajuda",
    description: "Aprenda a configurar e aproveitar todos os recursos da plataforma.",
  },
};

export function SuperAdminHelpCenterPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState<HelpCenterAdminConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<HelpCenterAdminConfig>("/super/help-center");
      setConfig(data);
    } catch {
      setError(t("superAdmin.helpCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.put("/super/help-center", config);
      invalidateHelpConfigCache();
      setMessage(t("superAdmin.helpCenter.saved"));
    } catch {
      setError(t("superAdmin.helpCenter.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-bold text-ink-900">{t("superAdmin.helpCenter.title")}</h1>
        <p className="mt-1 text-sm text-ink-600">{t("superAdmin.helpCenter.subtitle")}</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p> : null}

      <section className="space-y-4 rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-700 dark:bg-ink-900">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">{t("superAdmin.helpCenter.supportSection")}</h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.support.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, support: { ...c.support, enabled: e.target.checked } }))}
          />
          {t("superAdmin.helpCenter.supportEnabled")}
        </label>

        <div>
          <label className="text-sm font-medium text-ink-700">{t("superAdmin.helpCenter.phone")}</label>
          <input
            type="tel"
            value={config.support.phone}
            onChange={(e) => setConfig((c) => ({ ...c, support: { ...c.support, phone: e.target.value } }))}
            placeholder="+55 11 99999-9999"
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink-700">{t("superAdmin.helpCenter.whatsappMessage")}</label>
          <textarea
            rows={3}
            value={config.support.whatsappMessage}
            onChange={(e) => setConfig((c) => ({ ...c, support: { ...c.support, whatsappMessage: e.target.value } }))}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink-700">{t("superAdmin.helpCenter.supportTitle")}</label>
          <input
            type="text"
            value={config.support.title}
            onChange={(e) => setConfig((c) => ({ ...c, support: { ...c.support, title: e.target.value } }))}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink-700">{t("superAdmin.helpCenter.supportDescription")}</label>
          <textarea
            rows={2}
            value={config.support.description}
            onChange={(e) => setConfig((c) => ({ ...c, support: { ...c.support, description: e.target.value } }))}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-700 dark:bg-ink-900">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">{t("superAdmin.helpCenter.guideSection")}</h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.guide.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, guide: { ...c.guide, enabled: e.target.checked } }))}
          />
          {t("superAdmin.helpCenter.guideEnabled")}
        </label>

        <div>
          <label className="text-sm font-medium text-ink-700">{t("superAdmin.helpCenter.guideTitle")}</label>
          <input
            type="text"
            value={config.guide.title}
            onChange={(e) => setConfig((c) => ({ ...c, guide: { ...c.guide, title: e.target.value } }))}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink-700">{t("superAdmin.helpCenter.guideDescription")}</label>
          <textarea
            rows={2}
            value={config.guide.description}
            onChange={(e) => setConfig((c) => ({ ...c, guide: { ...c.guide, description: e.target.value } }))}
            className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
          />
        </div>
      </section>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? t("common.saving") : t("superAdmin.helpCenter.save")}
      </button>
    </div>
  );
}
