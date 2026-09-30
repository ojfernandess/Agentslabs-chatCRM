import type { ReactNode } from "react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";

export const GLOBAL_SETTINGS_TAB_IDS = [
  "publicDocs",
  "apiRateLimit",
  "typography",
  "conversations",
  "mediaStorage",
  "turnstile",
  "resend",
  "tenantPermissions",
  "platformRegistry",
] as const;

export type GlobalSettingsTabId = (typeof GLOBAL_SETTINGS_TAB_IDS)[number];

const TAB_LABEL_KEYS: Record<GlobalSettingsTabId, string> = {
  publicDocs: "superAdmin.globalSettingsTab.publicDocs",
  apiRateLimit: "superAdmin.globalSettingsTab.apiRateLimit",
  typography: "superAdmin.globalSettingsTab.typography",
  conversations: "superAdmin.globalSettingsTab.conversations",
  mediaStorage: "superAdmin.globalSettingsTab.mediaStorage",
  turnstile: "superAdmin.globalSettingsTab.turnstile",
  resend: "superAdmin.globalSettingsTab.resend",
  tenantPermissions: "superAdmin.globalSettingsTab.tenantPermissions",
  platformRegistry: "superAdmin.globalSettingsTab.platformRegistry",
};

type SuperAdminGlobalSettingsLayoutProps = {
  activeTab: GlobalSettingsTabId;
  onTabChange: (tab: GlobalSettingsTabId) => void;
  children: ReactNode;
};

export function SuperAdminGlobalSettingsLayout({
  activeTab,
  onTabChange,
  children,
}: SuperAdminGlobalSettingsLayoutProps) {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-ink-900 dark:text-ink-50">{t("superAdmin.globalSettings")}</h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("superAdmin.globalSettingsSubtitle")}</p>
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("superAdmin.globalSettingsTabsHint")}</p>
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-200 pb-2 lg:w-56 lg:flex-col lg:gap-0.5 lg:border-b-0 lg:border-r lg:pr-4 lg:pb-0 dark:border-ink-700"
          aria-label={t("superAdmin.globalSettings")}
        >
          {GLOBAL_SETTINGS_TAB_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={clsx(
                "whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                activeTab === id
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800",
              )}
            >
              {t(TAB_LABEL_KEYS[id])}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  );
}
