import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Keyboard,
  UserRound,
  Landmark,
  LogOut,
  Info,
  X,
  Building2,
} from "lucide-react";
import clsx from "clsx";
import type { AuthUser } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isSuperAdminRole } from "@/lib/authRole";
import { AnimatePresence, motion } from "@/components/Motion";

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
}

export function UserProfileMenu({ user, className, onLogout }: UserProfileMenuProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<Availability>(readAvailability);
  const [autoOffline, setAutoOffline] = useState(readAutoOffline);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const superAdmin = isSuperAdminRole(user.role);

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

  return (
    <div ref={rootRef} className={clsx("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
          "hover:bg-ink-50 dark:hover:bg-ink-800/80",
          open && "bg-ink-50 dark:bg-ink-800/80",
        )}
      >
        <span className="relative shrink-0">
          <span
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white",
              "bg-brand-500",
            )}
          >
            {initialsFromName(user.name ?? user.email ?? "")}
          </span>
          <span
            className={clsx(
              "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-ink-900",
              availDot,
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
            {user.name ?? "—"}
          </span>
          <span className="block truncate text-xs text-ink-500 dark:text-ink-400">{user.email}</span>
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className={clsx(
              "absolute bottom-full left-0 z-[100] mb-2 w-[min(20rem,calc(100vw-1.25rem))] min-w-[17.5rem] overflow-hidden rounded-lg border shadow-lg",
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
              {superAdmin ? (
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
                "relative w-full max-w-sm rounded-lg border border-ink-200 bg-white p-5 shadow-xl dark:border-ink-600 dark:bg-ink-800",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                  {t("profileMenu.shortcutsTitle")}
                </h2>
                <button
                  type="button"
                  className="rounded p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700"
                  onClick={() => setShortcutsOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ul className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
                <li className="flex justify-between gap-2">
                  <span>{t("profileMenu.shortcutCloseModal")}</span>
                  <kbd className="rounded border border-ink-200 bg-ink-50 px-2 py-0.5 text-xs font-mono dark:border-ink-600 dark:bg-ink-900">
                    Esc
                  </kbd>
                </li>
                <li className="flex justify-between gap-2">
                  <span>{t("profileMenu.shortcutNavigate")}</span>
                  <span className="text-xs text-ink-500">{t("profileMenu.shortcutNavigateHint")}</span>
                </li>
              </ul>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
