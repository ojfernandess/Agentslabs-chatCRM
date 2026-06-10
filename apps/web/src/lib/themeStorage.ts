export const THEME_STORAGE_KEY = "openconduit_theme";

export type ThemePref = "light" | "dark" | "system";

function readThemePref(): ThemePref {
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function applyDarkClass(pref: ThemePref) {
  let dark = false;
  if (pref === "dark") dark = true;
  else if (pref === "light") dark = false;
  else dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
}

/** Call once at startup (e.g. main.tsx) before paint. */
export function initThemeFromStorage() {
  applyDarkClass(readThemePref());
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    if (readThemePref() === "system") applyDarkClass("system");
  };
  mq.addEventListener("change", onScheme);
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_STORAGE_KEY) applyDarkClass(readThemePref());
  });
}

export function setThemePreference(pref: ThemePref) {
  localStorage.setItem(THEME_STORAGE_KEY, pref);
  applyDarkClass(pref);
  window.dispatchEvent(new CustomEvent("openconduit:theme-changed", { detail: { pref } }));
}

export function getThemePreference(): ThemePref {
  return readThemePref();
}
