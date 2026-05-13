export const FONT_SIZE_STORAGE_KEY = "openconduit_font_size";
export const SEND_SHORTCUT_STORAGE_KEY = "openconduit_send_shortcut";
export const AUDIO_ALERT_SOUND_STORAGE_KEY = "openconduit_audio_alert_sound";
export const AUDIO_ALERT_ONLY_WHEN_HIDDEN_STORAGE_KEY = "openconduit_audio_alert_only_when_hidden";
export const AUDIO_ALERT_REPEAT_STORAGE_KEY = "openconduit_audio_alert_repeat";

export type FontSizePref = "default" | "comfortable" | "large";
/** Enter envia; mod+enter = Ctrl+Enter / Cmd+Enter envia */
export type SendShortcutPref = "enter" | "mod_enter";
export type AudioAlertSoundPref = "none" | "ding" | "bell" | "chime" | "magic" | "ping";

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

export function readAudioAlertSoundPref(): AudioAlertSoundPref {
  const v = localStorage.getItem(AUDIO_ALERT_SOUND_STORAGE_KEY);
  if (v === "ding" || v === "bell" || v === "chime" || v === "magic" || v === "ping" || v === "none") return v;
  return "none";
}

export function setAudioAlertSoundPref(pref: AudioAlertSoundPref) {
  localStorage.setItem(AUDIO_ALERT_SOUND_STORAGE_KEY, pref);
}

export function readAudioAlertOnlyWhenHiddenPref(): boolean {
  const v = localStorage.getItem(AUDIO_ALERT_ONLY_WHEN_HIDDEN_STORAGE_KEY);
  if (v === "0") return false;
  if (v === "1") return true;
  return true;
}

export function setAudioAlertOnlyWhenHiddenPref(value: boolean) {
  localStorage.setItem(AUDIO_ALERT_ONLY_WHEN_HIDDEN_STORAGE_KEY, value ? "1" : "0");
}

export function readAudioAlertRepeatPref(): boolean {
  const v = localStorage.getItem(AUDIO_ALERT_REPEAT_STORAGE_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  return false;
}

export function setAudioAlertRepeatPref(value: boolean) {
  localStorage.setItem(AUDIO_ALERT_REPEAT_STORAGE_KEY, value ? "1" : "0");
}
