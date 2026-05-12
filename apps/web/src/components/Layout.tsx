import { Fragment, useState, useEffect, useCallback } from "react";
import { NavLink, Outlet, useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  UsersRound,
  LayoutGrid,
  Briefcase,
  Bell,
  Languages,
  Bot,
  Sparkles,
  ClipboardCheck,
  FileSearch,
  BarChart3,
  Megaphone,
  Inbox,
} from "lucide-react";
import clsx from "clsx";
import { ConversationNotifyBell } from "@/components/ConversationNotifyBell";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useConversationAlerts } from "@/hooks/useConversationAlerts";
import type { LocaleCode } from "@/i18n/messages";
import { isTenantAdmin } from "@/lib/authRole";
import { WorkspaceRealtime } from "@/components/WorkspaceRealtime";

type SidebarTeam = { id: string; name: string; unseenTransferCount?: number };
type SidebarInbox = { id: string; name: string };

const navItems = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { to: "/reports", icon: BarChart3, labelKey: "nav.reports" },
  { to: "/conversations", icon: MessageSquare, labelKey: "nav.conversations" },
  { to: "/contacts", icon: Users, labelKey: "nav.contacts" },
  { to: "/crm", icon: LayoutGrid, labelKey: "nav.crm" },
  { to: "/deals", icon: Briefcase, labelKey: "nav.deals" },
  { to: "/reminders", icon: Bell, labelKey: "nav.reminders" },
] as const;

export function Layout() {
  const { user, logout, exitUserImpersonation } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const showCrmKanban = user?.organizationFeatures?.crm_kanban ?? true;
  const showDeals = user?.organizationFeatures?.crm_deals ?? true;
  const { badgeCount, alertPreviews, clearBadge, requestDesktopPermission } = useConversationAlerts();
  const [sidebarTeams, setSidebarTeams] = useState<SidebarTeam[]>([]);
  const [sidebarInboxes, setSidebarInboxes] = useState<SidebarInbox[]>([]);

  const conversationTeamId =
    location.pathname === "/conversations" ? new URLSearchParams(location.search).get("teamId") : null;
  const conversationInboxId =
    location.pathname === "/conversations" ? new URLSearchParams(location.search).get("inboxId") : null;

  const fetchSidebarTeams = useCallback(() => {
    if (!user) {
      setSidebarTeams([]);
      return;
    }
    void api
      .get<{ data: { id: string; name: string; unseenTransferCount?: number }[] }>("/teams")
      .then((res) =>
        setSidebarTeams(
          res.data.map((x) => ({
            id: x.id,
            name: x.name,
            unseenTransferCount: x.unseenTransferCount ?? 0,
          })),
        ),
      )
      .catch(() => setSidebarTeams([]));
  }, [user?.id]);

  useEffect(() => {
    fetchSidebarTeams();
  }, [fetchSidebarTeams]);

  useEffect(() => {
    const refresh = () => fetchSidebarTeams();
    window.addEventListener("openconduit:conversation-transferred", refresh);
    window.addEventListener("openconduit:team-transfer-badges-refresh", refresh);
    return () => {
      window.removeEventListener("openconduit:conversation-transferred", refresh);
      window.removeEventListener("openconduit:team-transfer-badges-refresh", refresh);
    };
  }, [fetchSidebarTeams]);

  useEffect(() => {
    if (!user) {
      setSidebarInboxes([]);
      return;
    }
    let cancelled = false;
    void api
      .get<{ data: { id: string; name: string }[] }>("/inboxes")
      .then((res) => {
        if (!cancelled) setSidebarInboxes(res.data.map((x) => ({ id: x.id, name: x.name })));
      })
      .catch(() => {
        if (!cancelled) setSidebarInboxes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const navItemClass = (active: boolean) =>
    clsx(
      "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
      active
        ? "nav-link-active"
        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
    );

  const teamNavItemClass = (active: boolean) =>
    clsx(
      "flex min-h-0 items-center gap-2 rounded py-2 pl-9 pr-3 text-sm font-medium transition-colors",
      active
        ? "nav-link-active"
        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
    );

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 flex-col border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-[#151d28]">
        <div className="flex h-16 items-center gap-3 border-b border-ink-200 px-6 dark:border-ink-800">
          <img src="/logo.svg" alt="OpenNexo CRM" className="h-7" />
          <span className="text-lg font-bold text-ink-900 dark:text-ink-50">OpenNexo CRM</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems
            .filter((item) => {
              if (item.to === "/crm") return showCrmKanban;
              if (item.to === "/deals") return showDeals;
              return true;
            })
            .map((item) =>
            item.to === "/conversations" ? (
              <Fragment key="conversations-tree">
                <Link
                  to="/conversations"
                  className={navItemClass(
                    location.pathname === "/conversations" && !conversationTeamId && !conversationInboxId,
                  )}
                >
                  <MessageSquare className="h-5 w-5 shrink-0" />
                  {t("nav.conversations")}
                </Link>
                {sidebarTeams.length > 0 ? (
                  <div className="mb-1 mt-0.5 space-y-0.5">
                    <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                      {t("nav.teamInboxes")}
                    </p>
                    {sidebarTeams.map((team) => {
                      const n = team.unseenTransferCount ?? 0;
                      return (
                      <Link
                        key={team.id}
                        to={`/conversations?teamId=${encodeURIComponent(team.id)}`}
                        className={teamNavItemClass(
                          conversationTeamId === team.id && !conversationInboxId,
                        )}
                        title={team.name}
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{team.name}</span>
                        {n > 0 ? (
                          <span
                            className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white dark:bg-brand-500"
                            title={t("nav.teamTransferUnreadBadge")}
                            aria-label={`${t("nav.teamTransferUnreadBadge")}: ${n}`}
                          >
                            {n > 99 ? "99+" : n}
                          </span>
                        ) : null}
                      </Link>
                      );
                    })}
                  </div>
                ) : null}
                {sidebarInboxes.length > 0 ? (
                  <div className="mb-1 mt-0.5 space-y-0.5">
                    <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                      {t("nav.inboxShortcuts")}
                    </p>
                    {sidebarInboxes.map((inbox) => (
                      <Link
                        key={inbox.id}
                        to={`/conversations?inboxId=${encodeURIComponent(inbox.id)}`}
                        className={teamNavItemClass(conversationInboxId === inbox.id && !conversationTeamId)}
                        title={inbox.name}
                      >
                        <Inbox className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="min-w-0 truncate">{inbox.name}</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </Fragment>
            ) : (
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
            ),
          )}
          <NavLink
            to="/inboxes"
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
              )
            }
          >
            <Inbox className="h-5 w-5" />
            {t("nav.inboxes")}
          </NavLink>
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
                <Bot className="h-5 w-5" />
                {t("nav.bots")}
              </NavLink>
              <NavLink
                to="/automation"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
                  )
                }
              >
                <Sparkles className="h-5 w-5" />
                {t("nav.automation")}
              </NavLink>
              <NavLink
                to="/broadcasts"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "nav-link-active" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
                  )
                }
              >
                <Megaphone className="h-5 w-5" />
                {t("nav.broadcast")}
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="space-y-2 border-t border-ink-200 p-3 dark:border-ink-800">
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
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-500/25 bg-brand-950/90 px-4 py-2.5 text-sm text-brand-100 backdrop-blur-sm"
          >
            <span className="min-w-0">
              <span className="font-semibold text-brand-50">{t("common.userImpersonationBanner")}</span>
              <span className="text-brand-200/90">
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
        <main className="min-h-0 flex-1 overflow-auto bg-ink-50 dark:bg-ink-950">
          <Outlet />
        </main>
      </div>
      <WorkspaceRealtime />
    </div>
  );
}
