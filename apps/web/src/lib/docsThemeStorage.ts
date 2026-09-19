export const DOCS_THEME_STORAGE_KEY = "openconduit_docs_theme";

export type DocsTheme = "light" | "dark";

export function getDocsTheme(): DocsTheme {
  const value = localStorage.getItem(DOCS_THEME_STORAGE_KEY);
  return value === "dark" ? "dark" : "light";
}

export function setDocsTheme(theme: DocsTheme): void {
  localStorage.setItem(DOCS_THEME_STORAGE_KEY, theme);
  window.dispatchEvent(
    new CustomEvent("openconduit:docs-theme-changed", {
      detail: { theme },
    }),
  );
}
