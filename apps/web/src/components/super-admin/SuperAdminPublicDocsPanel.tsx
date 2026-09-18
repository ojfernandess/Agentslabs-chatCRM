import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export type PublicDocsSectionVisibility = {
  conventions: boolean;
  auth: boolean;
  schemas: boolean;
  changelog: boolean;
  quickGuide: boolean;
  emailGuide: boolean;
  n8nGuide: boolean;
  postmanDownload: boolean;
  botAutomationNav: boolean;
};

export type PublicDocsAdminConfig = {
  enabled: boolean;
  sections: PublicDocsSectionVisibility;
  groups: Record<string, boolean>;
  availableGroups: { id: string; titlePt: string }[];
};

const DEFAULT_SECTIONS: PublicDocsSectionVisibility = {
  conventions: true,
  auth: true,
  schemas: true,
  changelog: true,
  quickGuide: true,
  emailGuide: true,
  n8nGuide: true,
  postmanDownload: true,
  botAutomationNav: true,
};

const SECTION_KEYS: (keyof PublicDocsSectionVisibility)[] = [
  "conventions",
  "auth",
  "schemas",
  "changelog",
  "quickGuide",
  "emailGuide",
  "n8nGuide",
  "postmanDownload",
  "botAutomationNav",
];

export function SuperAdminPublicDocsPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PublicDocsAdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<PublicDocsAdminConfig>("/super/public-docs-config");
      setConfig(data);
    } catch {
      setError(t("superAdmin.publicApiDocsConfig.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const allGroupsSelected = useMemo(() => {
    if (!config) return true;
    return config.availableGroups.every((g) => config.groups[g.id] !== false);
  }, [config]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await api.put<PublicDocsAdminConfig>("/super/public-docs-config", {
        enabled: config.enabled,
        sections: config.sections,
        groups: config.groups,
      });
      setConfig(saved);
      setMessage(t("superAdmin.publicApiDocsConfig.saved"));
    } catch {
      setError(t("superAdmin.publicApiDocsConfig.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const setAllGroups = (value: boolean) => {
    setConfig((current) => {
      if (!current) return current;
      const groups = { ...current.groups };
      for (const g of current.availableGroups) groups[g.id] = value;
      return { ...current, groups };
    });
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
        <h2 className="font-semibold text-ink-900">{t("superAdmin.publicApiDocsTitle")}</h2>
        <p className="mt-1 text-sm text-ink-600">{t("superAdmin.publicApiDocsSubtitle")}</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p> : null}

      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-ink-200">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig((c) => (c ? { ...c, enabled: e.target.checked } : c))}
          className="rounded border-ink-300 dark:border-ink-600"
        />
        {t("superAdmin.publicApiDocsToggle")}
      </label>

      {config.enabled ? (
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t("superAdmin.publicApiDocsOpenPage")} →
        </a>
      ) : null}

      <div className="space-y-3 rounded-xl border border-ink-200 p-4 dark:border-ink-700">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          {t("superAdmin.publicApiDocsConfig.sectionsTitle")}
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {SECTION_KEYS.map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-ink-200">
              <input
                type="checkbox"
                checked={config.sections[key] ?? DEFAULT_SECTIONS[key]}
                onChange={(e) =>
                  setConfig((c) =>
                    c
                      ? {
                          ...c,
                          sections: { ...c.sections, [key]: e.target.checked },
                        }
                      : c,
                  )
                }
                className="rounded border-ink-300 dark:border-ink-600"
              />
              {t(`superAdmin.publicApiDocsConfig.section.${key}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-ink-200 p-4 dark:border-ink-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            {t("superAdmin.publicApiDocsConfig.groupsTitle")}
          </h3>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setAllGroups(true)}>
              {t("superAdmin.publicApiDocsConfig.selectAllGroups")}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setAllGroups(false)}>
              {t("superAdmin.publicApiDocsConfig.clearAllGroups")}
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {config.availableGroups.map((group) => (
            <label key={group.id} className="flex cursor-pointer items-start gap-2 text-sm text-ink-800 dark:text-ink-200">
              <input
                type="checkbox"
                checked={config.groups[group.id] !== false}
                onChange={(e) =>
                  setConfig((c) =>
                    c
                      ? {
                          ...c,
                          groups: { ...c.groups, [group.id]: e.target.checked },
                        }
                      : c,
                  )
                }
                className="mt-0.5 rounded border-ink-300 dark:border-ink-600"
              />
              <span>
                <span className="font-medium">{group.titlePt}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-ink-500">{group.id}</span>
              </span>
            </label>
          ))}
        </div>
        {!allGroupsSelected ? (
          <p className="text-xs text-ink-500">{t("superAdmin.publicApiDocsConfig.groupsHint")}</p>
        ) : null}
      </div>

      <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? t("common.loading") : t("common.save")}
      </button>
    </section>
  );
}
