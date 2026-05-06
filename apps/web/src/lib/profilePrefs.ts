export const FONT_SIZE_STORAGE_KEY = "openconduit_font_size";
export const SEND_SHORTCUT_STORAGE_KEY = "openconduit_send_shortcut";

export type FontSizePref = "default" | "comfortable" | "large";
/** Enter envia; mod+enter = Ctrl+Enter / Cmd+Enter envia */
export type SendShortcutPref = "enter" | "mod_enter";

export function readFontSizePref(): FontSizePref {
  const v = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (v === "comfortable" || v === "large" || v === "default") return v;
  return "default";
}

export function setFontSizePref(pref: FontSizePref) {
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, pref);
  applyFontSizeClass(pref);
}

export function applyFontSizeClass(pref: FontSizePref) {
  document.documentElement.classList.remove("font-size-comfortable", "font-size-large");
  if (pref === "comfortable") document.documentElement.classList.add("font-size-comfortable");
  if (pref === "large") document.documentElement.classList.add("font-size-large");
}

export function initFontSizeFromStorage() {
  applyFontSizeClass(readFontSizePref());
}

export function readSendShortcutPref(): SendShortcutPref {
  const v = localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY);
  if (v === "mod_enter") return "mod_enter";
  return "enter";
}

export function setSendShortcutPref(pref: SendShortcutPref) {
  localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, pref);
}
