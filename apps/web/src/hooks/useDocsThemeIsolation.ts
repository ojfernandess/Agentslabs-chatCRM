import { useCallback, useEffect, useState } from "react";
import { getDocsTheme, setDocsTheme, type DocsTheme } from "@/lib/docsThemeStorage";
import { getThemePreference, setThemePreference, THEME_STORAGE_KEY } from "@/lib/themeStorage";

/** Isola o tema da documentação pública do tema global da aplicação. */
export function useDocsThemeIsolation() {
  const [docsTheme, setDocsThemeState] = useState<DocsTheme>(() => getDocsTheme());

  const applyDocsTheme = useCallback((theme: DocsTheme) => {
    setDocsTheme(theme);
    setDocsThemeState(theme);
  }, []);

  const toggleDocsTheme = useCallback(() => {
    applyDocsTheme(docsTheme === "dark" ? "light" : "dark");
  }, [applyDocsTheme, docsTheme]);

  useEffect(() => {
    const stripGlobalDarkFromHtml = () => {
      const theme = getDocsTheme();
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = theme;
      document.documentElement.classList.toggle("docs-theme-dark", theme === "dark");
      document.body.classList.toggle("docs-theme-dark", theme === "dark");
    };

    stripGlobalDarkFromHtml();

    const onGlobalThemeChange = () => stripGlobalDarkFromHtml();
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) stripGlobalDarkFromHtml();
    };
    const onDocsThemeChange = () => {
      setDocsThemeState(getDocsTheme());
      stripGlobalDarkFromHtml();
    };

    window.addEventListener("openconduit:theme-changed", onGlobalThemeChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("openconduit:docs-theme-changed", onDocsThemeChange);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", stripGlobalDarkFromHtml);

    return () => {
      window.removeEventListener("openconduit:theme-changed", onGlobalThemeChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("openconduit:docs-theme-changed", onDocsThemeChange);
      media.removeEventListener("change", stripGlobalDarkFromHtml);
      document.documentElement.classList.remove("docs-theme-dark");
      document.body.classList.remove("docs-theme-dark");
      setThemePreference(getThemePreference());
    };
  }, []);

  return {
    docsTheme,
    isDark: docsTheme === "dark",
    setDocsTheme: applyDocsTheme,
    toggleDocsTheme,
  };
}
