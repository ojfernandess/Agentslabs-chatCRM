export const THEME_STORAGE_KEY = "openconduit_theme";

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function readThemePref(): ThemePref {
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve o tema efectivo (claro/escuro) a partir da preferência guardada. */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return systemPrefersDark() ? "dark" : "light";
}

function applyDarkClass(pref: ThemePref) {
  const resolved = resolveTheme(pref);
  const dark = resolved === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = resolved;
  window.dispatchEvent(
    new CustomEvent("openconduit:theme-changed", {
      detail: { pref, resolved },
    }),
  );
}

/** Call once at startup (e.g. main.tsx) before paint. */
export function initThemeFromStorage() {
  applyDarkClass(readThemePref());
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    if (readThemePref() === "system") applyDarkClass("system");
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onScheme);
  } else {
    mq.addListener(onScheme);
  }
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_STORAGE_KEY) applyDarkClass(readThemePref());
  });
}

export function setThemePreference(pref: ThemePref) {
  localStorage.setItem(THEME_STORAGE_KEY, pref);
  applyDarkClass(pref);
}

export function getThemePreference(): ThemePref {
  return readThemePref();
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(readThemePref());
}
