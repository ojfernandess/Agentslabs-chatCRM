import { useEffect, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { getThemePreference, setThemePreference, type ThemePref } from "@/lib/themeStorage";

type PublicThemeToggleProps = {
  className?: string;
};

export function PublicThemeToggle({ className }: PublicThemeToggleProps) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemePref>(() => getThemePreference());

  useEffect(() => {
    const sync = () => setTheme(getThemePreference());
    window.addEventListener("openconduit:theme-changed", sync);
    return () => window.removeEventListener("openconduit:theme-changed", sync);
  }, []);

  return (
    <label className={clsx("inline-flex items-center gap-2 text-sm", className)}>
      <span className="sr-only">{t("profilePage.theme")}</span>
      <select
        value={theme}
        onChange={(event) => {
          const next = event.target.value as ThemePref;
          setTheme(next);
          setThemePreference(next);
        }}
        className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm font-medium text-ink-700 shadow-sm dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
        aria-label={t("profilePage.theme")}
      >
        <option value="light">{t("profileMenu.themeLight")}</option>
        <option value="dark">{t("profileMenu.themeDark")}</option>
        <option value="system">{t("profileMenu.themeSystem")}</option>
      </select>
    </label>
  );
}
