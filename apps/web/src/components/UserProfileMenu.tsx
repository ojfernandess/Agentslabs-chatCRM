import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Keyboard,
  UserRound,
  Landmark,
  LogOut,
  Info,
  X,
  Building2,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import clsx from "clsx";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isSuperAdminRole, isTenantAdmin } from "@/lib/authRole";
import { resolveUserAvatarUrl } from "@/lib/userAvatar";
import { AnimatePresence, motion } from "@/components/Motion";
import { getThemePreference, setThemePreference, type ThemePref } from "@/lib/themeStorage";

const AVAIL_STORAGE = "openconduit_availability";
const AUTO_OFFLINE_STORAGE = "openconduit_auto_offline";

type Availability = "online" | "away" | "offline";

function readAvailability(): Availability {
  const v = localStorage.getItem(AVAIL_STORAGE);
  if (v === "away" || v === "offline" || v === "online") return v;
  return "online";
}

function readAutoOffline(): boolean {
  return localStorage.getItem(AUTO_OFFLINE_STORAGE) === "1";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface UserProfileMenuProps {
  user: AuthUser;
  className?: string;
  onLogout: () => void;
  /** Apenas avatar (menu lateral recolhido). */
  compact?: boolean;
}

export function UserProfileMenu({ user, className, onLogout, compact = false }: UserProfileMenuProps) {
  const { t } = useI18n();
  const { exitOrganization } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<Availability>(readAvailability);
  const [autoOffline, setAutoOffline] = useState(readAutoOffline);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePreference);
  const rootRef = useRef<HTMLDivElement>(null);
  const superAdmin = isSuperAdminRole(user.role);
  const tenantAdmin = isTenantAdmin(user.role, user.actingOrganizationId);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || !!el?.isContentEditable;
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onAvail = () => {
      setAvailability(readAvailability());
    };
    window.addEventListener("openconduit:availability-changed", onAvail);
    return () => window.removeEventListener("openconduit:availability-changed", onAvail);
  }, []);

  useEffect(() => {
    const onTheme = (e: Event) => {
      const pref = (e as CustomEvent<{ pref?: ThemePref }>).detail?.pref;
      if (pref === "light" || pref === "dark" || pref === "system") {
        setTheme(pref);
      } else {
        setTheme(getThemePreference());
      }
    };
    window.addEventListener("openconduit:theme-changed", onTheme);
    return () => window.removeEventListener("openconduit:theme-changed", onTheme);
  }, []);

  const pickTheme = useCallback((pref: ThemePref) => {
    setTheme(pref);
    setThemePreference(pref);
  }, []);

  const Keycap = ({ children }: { children: ReactNode }) => (
    <kbd className="rounded-md border border-ink-200 bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-700 shadow-sm dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100">
      {children}
    </kbd>
  );

  const ShortcutRow = ({ label, keys }: { label: string; keys: ReactNode }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-700 dark:text-ink-200">{label}</span>
      <span className="flex items-center gap-1.5">{keys}</span>
    </div>
  );

  const themeOptions: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("profileMenu.themeLight"), icon: Sun },
    { value: "dark", label: t("profileMenu.themeDark"), icon: Moon },
    { value: "system", label: t("profileMenu.themeSystem"), icon: Monitor },
  ];

  useEffect(() => {
    if (!autoOffline) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        localStorage.setItem(AVAIL_STORAGE, "offline");
        setAvailability("offline");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [autoOffline]);

  const setAvail = useCallback((v: Availability) => {
    setAvailability(v);
    localStorage.setItem(AVAIL_STORAGE, v);
    window.dispatchEvent(new CustomEvent("openconduit:availability-changed"));
  }, []);

  const setAutoOff = useCallback((on: boolean) => {
    setAutoOffline(on);
    localStorage.setItem(AUTO_OFFLINE_STORAGE, on ? "1" : "0");
  }, []);

  const availDot =
    availability === "online"
      ? "bg-emerald-500"
      : availability === "away"
        ? "bg-amber-400"
        : "bg-ink-400";

  const avatarSrc = resolveUserAvatarUrl(user.avatarUrl);

  return (
    <div ref={rootRef} className={clsx("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={compact ? (user.name ?? user.email) : undefined}
        className={clsx(
          "flex min-w-0 items-center rounded-lg transition-colors",
          compact ? "justify-center p-1.5" : "w-full gap-2.5 px-2 py-2 text-left",
          "hover:bg-ink-50 dark:hover:bg-ink-800/80",
          open && "bg-ink-50 dark:bg-ink-800/80",
        )}
      >
        <span className="relative shrink-0">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              className={clsx("rounded-full object-cover ring-1 ring-ink-200/80 dark:ring-ink-700", compact ? "h-9 w-9" : "h-9 w-9")}
            />
          ) : (
            <span
              className={clsx(
                "flex items-center justify-center rounded-full text-xs font-semibold text-white",
                compact ? "h-9 w-9" : "h-9 w-9",
                "bg-brand-500",
              )}
            >
              {initialsFromName(user.name ?? user.email ?? "")}
            </span>
          )}
          <span
            className={clsx(
              "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-ink-900",
              availDot,
            )}
          />
        </span>
        {!compact ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
              {user.name ?? "—"}
            </span>
            <span className="block truncate text-xs text-ink-500 dark:text-ink-400">{user.email}</span>
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className={clsx(
              "absolute z-[100] w-[min(20rem,calc(100vw-1.25rem))] min-w-[17.5rem] overflow-hidden rounded-lg border shadow-lg",
              compact
                ? "bottom-0 left-full ml-2"
                : "bottom-full left-0 mb-2",
              "border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-800",
            )}
          >
            <div className="space-y-3 border-b border-ink-100 px-3 py-3 dark:border-ink-600">
              <div>
                <label className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="shrink-0 text-xs font-medium text-ink-600 dark:text-ink-300">
                    {t("profileMenu.availability")}
                  </span>
                  <select
                    value={availability}
                    onChange={(e) => setAvail(e.target.value as Availability)}
                    className={clsx(
                      "w-full min-w-0 rounded-md border border-ink-200 bg-white py-1.5 pl-2 pr-8 text-xs font-medium text-ink-800 sm:max-w-[11rem] sm:flex-1 dark:border-ink-500 dark:bg-ink-900 dark:text-ink-100",
                    )}
                  >
                    <option value="online">{t("profileMenu.online")}</option>
                    <option value="away">{t("profileMenu.away")}</option>
                    <option value="offline">{t("profileMenu.offline")}</option>
                  </select>
                </label>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 text-xs leading-snug text-ink-600 dark:text-ink-300">
                  {t("profileMenu.autoOffline")}
                  <span
                    title={t("profileMenu.autoOfflineHint")}
                    className="ml-1 inline-block align-middle text-ink-400"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoOffline}
                  onClick={() => setAutoOff(!autoOffline)}
                  className={clsx(
                    "mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
                    autoOffline ? "justify-end bg-brand-500" : "justify-start bg-ink-200 dark:bg-ink-600",
                  )}
                >
                  <span className="pointer-events-none h-5 w-5 rounded-full bg-white shadow" />
                </button>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-ink-600 dark:text-ink-300">
                  {t("profileMenu.changeTheme")}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {themeOptions.map((opt) => {
                    const Icon = opt.icon;
                    const active = theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => pickTheme(opt.value)}
                        title={opt.label}
                        className={clsx(
                          "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                          active
                            ? "border-brand-400/60 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-950/50 dark:text-brand-200"
                            : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-300 dark:hover:bg-ink-700/60",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <nav className="py-1">
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-700/60"
                onClick={() => {
                  setShortcutsOpen(true);
                  setOpen(false);
                }}
              >
                <Keyboard className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                <span className="min-w-0 flex-1 leading-snug">{t("profileMenu.keyboardShortcuts")}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-700/60"
                onClick={() => {
                  setOpen(false);
                  navigate("/profile");
                }}
              >
                <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                <span className="min-w-0 flex-1 leading-snug">{t("profileMenu.profileSettings")}</span>
              </button>
              {tenantAdmin ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-700/60"
                  onClick={() => {
                    setOpen(false);
                    navigate("/settings");
                  }}
                >
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 leading-snug">{t("profileMenu.organizationSettings")}</span>
                </button>
              ) : null}
              {superAdmin && user.actingOrganizationId ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-700/60"
                  onClick={() => {
                    setOpen(false);
                    void exitOrganization().then(() => navigate("/super"));
                  }}
                >
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 leading-snug">{t("common.backToSuperAdmin")}</span>
                </button>
              ) : null}
              {superAdmin && !user.actingOrganizationId ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-700/60"
                  onClick={() => {
                    setOpen(false);
                    navigate("/super");
                  }}
                >
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 leading-snug">{t("profileMenu.superAdminConsole")}</span>
                </button>
              ) : null}
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
              >
                <LogOut className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 leading-snug">{t("profileMenu.signOut")}</span>
              </button>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {shortcutsOpen ? (
          <motion.div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label={t("common.close")}
              onClick={() => setShortcutsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className={clsx(
                "relative w-full max-w-4xl rounded-xl border border-ink-200 bg-white p-6 shadow-xl dark:border-ink-700 dark:bg-ink-900",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                  {t("profileMenu.shortcutsTitle")}
                </h2>
                <button
                  type="button"
                  className="rounded-md p-1 text-ink-500 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                  onClick={() => setShortcutsOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <ShortcutRow
                    label={t("profileMenu.shortcutToggleModal")}
                    keys={
                      <>
                        <Keycap>Win / ⌘</Keycap>
                        <Keycap>/</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutOpenConversation")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>J</Keycap>
                        <span className="px-1 text-xs text-ink-500 dark:text-ink-400">/</span>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>K</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutDropdownNav")}
                    keys={
                      <>
                        <Keycap>Up</Keycap>
                        <Keycap>Down</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutGoConversations")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>C</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutGoContacts")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>V</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutGoReports")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>R</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutGoSettings")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>S</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutReply")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>L</Keycap>
                      </>
                    }
                  />
                </div>

                <div className="space-y-3">
                  <ShortcutRow
                    label={t("profileMenu.shortcutResolveNext")}
                    keys={
                      <>
                        <Keycap>Win / ⌘</Keycap>
                        <Keycap>E</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutResolve")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>E</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutAddAttachment")}
                    keys={
                      <>
                        <Keycap>Win / ⌘</Keycap>
                        <Keycap>A</Keycap>
                        <span className="px-1 text-xs text-ink-500 dark:text-ink-400">ou</span>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>A</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutToggleSidebar")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>O</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutNextConversationTab")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>N</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutPrivateNote")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>P</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow
                    label={t("profileMenu.shortcutToggleSnooze")}
                    keys={
                      <>
                        <Keycap>Alt / ⌥</Keycap>
                        <Keycap>M</Keycap>
                      </>
                    }
                  />
                  <ShortcutRow label={t("profileMenu.shortcutCloseModal")} keys={<Keycap>Esc</Keycap>} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
