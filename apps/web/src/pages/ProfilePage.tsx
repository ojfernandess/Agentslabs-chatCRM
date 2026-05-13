import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { User, Building2, Volume2 } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import type { LocaleCode } from "@/i18n/messages";
import { PageTransition } from "@/components/Motion";
import {
  type FontSizePref,
  readFontSizePref,
  setFontSizePref,
  readSendShortcutPref,
  setSendShortcutPref,
  type SendShortcutPref,
  type AudioAlertSoundPref,
  readAudioAlertOnlyWhenHiddenPref,
  readAudioAlertRepeatPref,
  readAudioAlertSoundPref,
  setAudioAlertOnlyWhenHiddenPref,
  setAudioAlertRepeatPref,
  setAudioAlertSoundPref,
} from "@/lib/profilePrefs";
import { getThemePreference, setThemePreference, type ThemePref } from "@/lib/themeStorage";
import { playAudioAlert, unlockAudioAlerts } from "@/lib/audioAlerts";

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { t, locale, setLocale } = useI18n();

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signature, setSignature] = useState("");
  const [showAgentNameInChat, setShowAgentNameInChat] = useState(false);
  const [fontSize, setFontSize] = useState<FontSizePref>("default");
  const [theme, setTheme] = useState<ThemePref>("system");
  const [sendShortcut, setSendShortcut] = useState<SendShortcutPref>("enter");
  const [audioSound, setAudioSound] = useState<AudioAlertSoundPref>("none");
  const [audioOnlyWhenHidden, setAudioOnlyWhenHidden] = useState(true);
  const [audioRepeat, setAudioRepeat] = useState(false);

  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confPwd, setConfPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState("");
  const [apiTokenBusy, setApiTokenBusy] = useState(false);
  const [apiTokenMsg, setApiTokenMsg] = useState("");
  const [apiTokenValue, setApiTokenValue] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setDisplayName(user.displayName ?? "");
    setSignature(user.messageSignature ?? "");
    setShowAgentNameInChat(!!user.showAgentNameInChat);
    setFontSize(readFontSizePref());
    setTheme(getThemePreference());
    setSendShortcut(readSendShortcutPref());
    setAudioSound(readAudioAlertSoundPref());
    setAudioOnlyWhenHidden(readAudioAlertOnlyWhenHiddenPref());
    setAudioRepeat(readAudioAlertRepeatPref());
  }, [user]);

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setProfileMsg("");
    setProfileBusy(true);
    try {
      await api.patch("/auth/me", {
        name: name.trim(),
        displayName: displayName.trim() || null,
        messageSignature: signature.trim() || null,
        showAgentNameInChat,
      });
      await refreshUser();
      setProfileMsg(t("profilePage.profileSaved"));
    } catch (err) {
      setProfileMsg(err instanceof ApiError ? err.message : "Error");
    } finally {
      setProfileBusy(false);
    }
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwdMsg("");
    if (newPwd !== confPwd) {
      setPwdMsg(t("profilePage.passwordMismatch"));
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg(t("profilePage.passwordTooShort"));
      return;
    }
    setPwdBusy(true);
    try {
      await api.post("/auth/me/password", {
        currentPassword: curPwd,
        newPassword: newPwd,
      });
      setCurPwd("");
      setNewPwd("");
      setConfPwd("");
      setPwdMsg(t("profilePage.passwordChanged"));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "";
      setPwdMsg(
        msg.toLowerCase().includes("incorrect") ? t("profilePage.passwordWrong") : msg || "Error",
      );
    } finally {
      setPwdBusy(false);
    }
  };

  const onGenerateApiToken = async () => {
    setApiTokenBusy(true);
    setApiTokenMsg("");
    try {
      const res = await api.post<{ token: string; prefix: string; message: string }>("/auth/me/access-token");
      setApiTokenValue(res.token);
      setApiTokenMsg(t("profilePage.apiTokenGenerated"));
      await refreshUser();
    } catch (err) {
      setApiTokenMsg(err instanceof ApiError ? err.message : "Error");
    } finally {
      setApiTokenBusy(false);
    }
  };

  const onRevokeApiToken = async () => {
    setApiTokenBusy(true);
    setApiTokenMsg("");
    try {
      await api.delete("/auth/me/access-token");
      setApiTokenValue(null);
      setApiTokenMsg(t("profilePage.apiTokenRevoked"));
      await refreshUser();
    } catch (err) {
      setApiTokenMsg(err instanceof ApiError ? err.message : "Error");
    } finally {
      setApiTokenBusy(false);
    }
  };

  const onCopyApiToken = async () => {
    if (!apiTokenValue) return;
    try {
      await navigator.clipboard.writeText(apiTokenValue);
      setApiTokenMsg(t("profilePage.apiTokenCopied"));
    } catch {
      setApiTokenMsg(t("profilePage.apiTokenCopyFailed"));
    }
  };

  if (!user) return null;
  const canManageApiToken = user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);

  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl space-y-8 p-6 md:p-8">
        <header>
          <div className="flex items-center gap-3">
            <User className="h-8 w-8 text-brand-600" />
            <div>
              <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">{t("profilePage.title")}</h1>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("profilePage.subtitle")}</p>
            </div>
          </div>
        </header>

        <form onSubmit={onSaveProfile} className="card-surface space-y-6 p-6 dark:border-ink-600 dark:bg-ink-900/80">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div
              className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl font-bold text-white shadow-md"
              aria-hidden
            >
              {initials(name || user.email)}
            </div>
            <p className="text-xs text-ink-500 dark:text-ink-400 sm:pt-2">{t("profilePage.avatarHint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                {t("profilePage.fullName")}
              </label>
              <input
                className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-50"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                {t("profilePage.displayName")}
              </label>
              <input
                className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-50"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={200}
                placeholder={t("profilePage.displayNameHint")}
              />
              <p className="mt-1 text-xs text-ink-500">{t("profilePage.displayNameHint")}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                {t("profilePage.email")}
              </label>
              <input
                className="input-field mt-1 bg-ink-50 dark:border-ink-600 dark:bg-ink-800/60"
                value={user.email}
                readOnly
                disabled
              />
              <p className="mt-1 text-xs text-ink-500">{t("profilePage.emailReadOnly")}</p>
            </div>
          </div>

          <div className="border-t border-ink-200 pt-6 dark:border-ink-600">
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("profilePage.interfaceSection")}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("profilePage.fontSize")}
                </label>
                <select
                  className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800"
                  value={fontSize}
                  onChange={(e) => {
                    const v = e.target.value as FontSizePref;
                    setFontSize(v);
                    setFontSizePref(v);
                  }}
                >
                  <option value="default">{t("profilePage.fontDefault")}</option>
                  <option value="comfortable">{t("profilePage.fontComfortable")}</option>
                  <option value="large">{t("profilePage.fontLarge")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("profilePage.preferredLanguage")}
                </label>
                <select
                  className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as LocaleCode)}
                >
                  <option value="pt-BR">{t("common.ptBR")}</option>
                  <option value="en">{t("common.en")}</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("profilePage.theme")}
                </label>
                <select
                  className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800"
                  value={theme}
                  onChange={(e) => {
                    const v = e.target.value as ThemePref;
                    setTheme(v);
                    setThemePreference(v);
                  }}
                >
                  <option value="light">{t("profileMenu.themeLight")}</option>
                  <option value="dark">{t("profileMenu.themeDark")}</option>
                  <option value="system">{t("profileMenu.themeSystem")}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-ink-200 pt-6 dark:border-ink-600">
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("profilePage.audioAlertsTitle")}</h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("profilePage.audioAlertsSubtitle")}</p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("profilePage.audioAlertsSoundLabel")}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    className="input-field dark:border-ink-600 dark:bg-ink-800"
                    value={audioSound}
                    onChange={(e) => {
                      const v = e.target.value as AudioAlertSoundPref;
                      setAudioSound(v);
                      setAudioAlertSoundPref(v);
                    }}
                  >
                    <option value="none">{t("profilePage.audioAlertsSoundNone")}</option>
                    <option value="ding">{t("profilePage.audioAlertsSoundDing")}</option>
                    <option value="bell">{t("profilePage.audioAlertsSoundBell")}</option>
                    <option value="chime">{t("profilePage.audioAlertsSoundChime")}</option>
                    <option value="magic">{t("profilePage.audioAlertsSoundMagic")}</option>
                    <option value="ping">{t("profilePage.audioAlertsSoundPing")}</option>
                  </select>
                  <button
                    type="button"
                    className={clsx(
                      "flex h-11 w-11 items-center justify-center rounded-lg border transition-colors",
                      "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
                      "dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:hover:bg-white/10",
                    )}
                    aria-label={t("profilePage.audioAlertsTest")}
                    title={t("profilePage.audioAlertsTest")}
                    onClick={() => {
                      void unlockAudioAlerts().then(() => playAudioAlert(audioSound, 0.9));
                    }}
                    disabled={audioSound === "none"}
                  >
                    <Volume2 className="h-5 w-5" />
                  </button>
                </div>
                {audioSound === "none" ? (
                  <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("profilePage.audioAlertsNoneHint")}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("profilePage.audioAlertsConditions")}
                </div>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500 dark:border-white/10 dark:bg-ink-800"
                    checked={audioOnlyWhenHidden}
                    onChange={(e) => {
                      setAudioOnlyWhenHidden(e.target.checked);
                      setAudioAlertOnlyWhenHiddenPref(e.target.checked);
                    }}
                  />
                  <span className="text-sm text-ink-700 dark:text-ink-200">
                    {t("profilePage.audioAlertsOnlyWhenHidden")}
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500 dark:border-white/10 dark:bg-ink-800"
                    checked={audioRepeat}
                    onChange={(e) => {
                      setAudioRepeat(e.target.checked);
                      setAudioAlertRepeatPref(e.target.checked);
                    }}
                  />
                  <span className="text-sm text-ink-700 dark:text-ink-200">
                    {t("profilePage.audioAlertsRepeat")}
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="border-t border-ink-200 pt-6 dark:border-ink-600">
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
              {t("profilePage.signatureSection")}
            </h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("profilePage.signatureHint")}</p>
            <textarea
              className="input-field mt-3 min-h-[100px] resize-y font-mono text-sm dark:border-ink-600 dark:bg-ink-800"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              maxLength={8000}
              placeholder="—"
            />
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800"
                checked={showAgentNameInChat}
                onChange={(e) => setShowAgentNameInChat(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-ink-800 dark:text-ink-100">
                  {t("profilePage.showAgentNameInChat")}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">
                  {t("profilePage.showAgentNameInChatHint")}
                </span>
              </span>
            </label>
          </div>

          <div className="border-t border-ink-200 pt-6 dark:border-ink-600">
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
              {t("profilePage.sendShortcutSection")}
            </h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("profilePage.sendShortcutHint")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setSendShortcut("enter");
                  setSendShortcutPref("enter");
                }}
                className={clsx(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  sendShortcut === "enter"
                    ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100"
                    : "border-ink-200 hover:bg-ink-50 dark:border-ink-600 dark:hover:bg-ink-800",
                )}
              >
                {t("profilePage.sendShortcutEnter")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSendShortcut("mod_enter");
                  setSendShortcutPref("mod_enter");
                }}
                className={clsx(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  sendShortcut === "mod_enter"
                    ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100"
                    : "border-ink-200 hover:bg-ink-50 dark:border-ink-600 dark:hover:bg-ink-800",
                )}
              >
                {t("profilePage.sendShortcutModEnter")}
              </button>
            </div>
          </div>

          {profileMsg && (
            <p className="text-sm text-ink-600 dark:text-ink-300">{profileMsg}</p>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={profileBusy} className="btn-primary">
              {profileBusy ? "…" : t("profilePage.updateProfile")}
            </button>
            <Link to="/settings" className="btn-secondary inline-flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {t("profilePage.goToOrgSettings")}
            </Link>
          </div>
        </form>

        <div className="card-surface p-6 dark:border-ink-600 dark:bg-ink-900/80">
          <p className="text-sm text-ink-600 dark:text-ink-300">{t("profilePage.notificationsNote")}</p>
        </div>

        {canManageApiToken ? (
        <div className="card-surface space-y-4 p-6 dark:border-ink-600 dark:bg-ink-900/80">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("profilePage.apiTokenSection")}</h2>
          <p className="text-xs text-ink-500 dark:text-ink-400">{t("profilePage.apiTokenHint")}</p>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs dark:border-ink-600 dark:bg-ink-800/70">
            <div>
              {t("profilePage.apiTokenStatus")}{" "}
              {user.hasApiAccessToken ? t("profilePage.apiTokenConfigured") : t("profilePage.apiTokenNotConfigured")}
            </div>
            {user.apiAccessTokenPrefix ? (
              <div className="mt-1">
                {t("profilePage.apiTokenPrefix")}: <code>{user.apiAccessTokenPrefix}...</code>
              </div>
            ) : null}
            {user.apiAccessTokenLastUsedAt ? (
              <div className="mt-1">
                {t("profilePage.apiTokenLastUsed")}: {new Date(user.apiAccessTokenLastUsedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          {apiTokenValue ? (
            <div>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                {t("profilePage.apiTokenOneTime")}
              </label>
              <textarea
                className="input-field mt-1 min-h-[90px] font-mono text-xs dark:border-ink-600 dark:bg-ink-800"
                value={apiTokenValue}
                readOnly
              />
            </div>
          ) : null}
          {apiTokenMsg ? <p className="text-sm text-ink-600 dark:text-ink-300">{apiTokenMsg}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={apiTokenBusy} className="btn-primary" onClick={onGenerateApiToken}>
              {apiTokenBusy ? "…" : t("profilePage.apiTokenGenerate")}
            </button>
            {apiTokenValue ? (
              <button type="button" disabled={apiTokenBusy} className="btn-secondary" onClick={onCopyApiToken}>
                {t("profilePage.apiTokenCopy")}
              </button>
            ) : null}
            {user.hasApiAccessToken ? (
              <button type="button" disabled={apiTokenBusy} className="btn-secondary" onClick={onRevokeApiToken}>
                {t("profilePage.apiTokenRevoke")}
              </button>
            ) : null}
          </div>
        </div>
        ) : null}

        <form onSubmit={onChangePassword} className="card-surface space-y-4 p-6 dark:border-ink-600 dark:bg-ink-900/80">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("profilePage.passwordSection")}</h2>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
              {t("profilePage.currentPassword")}
            </label>
            <input
              type="password"
              className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800"
              value={curPwd}
              onChange={(e) => setCurPwd(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
              {t("profilePage.newPassword")}
            </label>
            <input
              type="password"
              className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">
              {t("profilePage.confirmPassword")}
            </label>
            <input
              type="password"
              className="input-field mt-1 dark:border-ink-600 dark:bg-ink-800"
              value={confPwd}
              onChange={(e) => setConfPwd(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {pwdMsg && <p className="text-sm text-ink-600 dark:text-ink-300">{pwdMsg}</p>}
          <button type="submit" disabled={pwdBusy} className="btn-primary">
            {pwdBusy ? "…" : t("profilePage.changePassword")}
          </button>
        </form>
      </div>
    </PageTransition>
  );
}
