import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  UsersRound,
  LayoutGrid,
  Briefcase,
  Bell,
  Languages,
  Box,
  ClipboardCheck,
  FileSearch,
} from "lucide-react";
import clsx from "clsx";
import { ConversationNotifyBell } from "@/components/ConversationNotifyBell";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useConversationAlerts } from "@/hooks/useConversationAlerts";
import type { LocaleCode } from "@/i18n/messages";
import { isSuperAdminRole, isTenantAdmin } from "@/lib/authRole";
import { WorkspaceRealtime } from "@/components/WorkspaceRealtime";
const navItems = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { to: "/conversations", icon: MessageSquare, labelKey: "nav.conversations" },
  { to: "/contacts", icon: Users, labelKey: "nav.contacts" },
  { to: "/crm", icon: LayoutGrid, labelKey: "nav.crm" },
  { to: "/deals", icon: Briefcase, labelKey: "nav.deals" },
  { to: "/reminders", icon: Bell, labelKey: "nav.reminders" },
] as const;

export function Layout() {
  const { user, logout, exitOrganization, exitUserImpersonation } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const { badgeCount, alertPreviews, clearBadge, requestDesktopPermission } = useConversationAlerts();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 flex-col border-r border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900">
        <div className="flex h-16 items-center gap-3 border-b border-ink-200 px-6 dark:border-ink-700">
          <img src="/logo.svg" alt="OpenConduit" className="h-7" />
          <span className="text-lg font-bold text-ink-900 dark:text-ink-50">OpenConduit</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {t(item.labelKey)}
            </NavLink>
          ))}
          <NavLink
            to="/my-attendance"
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
              )
            }
          >
            <ClipboardCheck className="h-5 w-5" />
            {t("nav.myAttendance")}
          </NavLink>
          {tenantAdmin ? (
            <>
              <NavLink
                to="/conversation-audit"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
                  )
                }
              >
                <FileSearch className="h-5 w-5" />
                {t("nav.conversationAudit")}
              </NavLink>
              <NavLink
                to="/teams"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
                  )
                }
              >
                <UsersRound className="h-5 w-5" />
                {t("nav.teams")}
              </NavLink>
              <NavLink
                to="/bots"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
                  )
                }
              >
                <Box className="h-5 w-5" />
                {t("nav.bots")}
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="space-y-2 border-t border-ink-200 p-3 dark:border-ink-700">
          <div className="flex items-end gap-2">
            <ConversationNotifyBell
              badgeCount={badgeCount}
              alertPreviews={alertPreviews}
              clearBadge={clearBadge}
            />
            {user ? (
              <UserProfileMenu user={user} onLogout={() => handleLogout()} className="min-w-0 flex-1" />
            ) : null}
          </div>
          {typeof Notification !== "undefined" && Notification.permission === "default" ? (
            <button
              type="button"
              onClick={() => void requestDesktopPermission()}
              className="w-full rounded-lg py-1 text-center text-[11px] text-brand-600 hover:text-brand-800 dark:text-brand-400"
            >
              {t("nav.enableDesktopNotifications")}
            </button>
          ) : null}
          <div className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-900/50">
            <Languages className="h-4 w-4 shrink-0 text-ink-500" />
            <label htmlFor="locale" className="sr-only">
              {t("common.language")}
            </label>
            <select
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleCode)}
              className="w-full min-w-0 flex-1 border-0 bg-transparent text-xs font-medium text-ink-700 focus:ring-0 dark:text-ink-200"
            >
              <option value="pt-BR">{t("common.ptBR")}</option>
              <option value="en">{t("common.en")}</option>
            </select>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {user?.superAdminActorId ? (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-ink-900"
          >
            <span className="min-w-0">
              <span className="font-semibold">{t("common.userImpersonationBanner")}</span>
              <span className="text-ink-700">
                {" "}
                {user.name} ({user.email}) · {t("common.actor")}:{" "}
                {user.superAdminActor?.name ?? user.superAdminActor?.email ?? "—"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                void exitUserImpersonation().then(() => navigate("/super"));
              }}
              className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
            >
              {t("common.exitUserImpersonation")}
            </button>
          </div>
        ) : null}
        {isSuperAdminRole(user?.role) && user?.actingOrganizationId && !user?.superAdminActorId ? (
          <div
            role="status"
            className="flex shrink-0 items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 sm:items-center sm:justify-between"
          >
            <span className="min-w-0">
              <span className="font-semibold">{user.actingOrganization?.name ?? "—"}</span>
              <span className="text-amber-900/90"> — {t("common.impersonationBanner")}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                void exitOrganization().then(() => navigate("/super"));
              }}
              className="shrink-0 rounded bg-white px-3 py-1.5 text-xs font-medium text-amber-950 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100"
            >
              {t("common.backToSuperAdmin")}
            </button>
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-auto bg-ink-50 dark:bg-ink-950">
          <Outlet />
        </main>
      </div>
      <WorkspaceRealtime />
    </div>
  );
}
