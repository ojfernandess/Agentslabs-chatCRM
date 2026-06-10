import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
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
  Brain,
  Menu,
  X,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import clsx from "clsx";
import { ConversationNotifyBell } from "@/components/ConversationNotifyBell";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useConversationAlerts } from "@/hooks/useConversationAlerts";
import { useActionableReminders } from "@/hooks/useActionableReminders";
import { ReminderActionableBanner } from "@/components/reminders/ReminderActionableBanner";
import { useConversationBubbleTheme } from "@/hooks/useConversationBubbleTheme";
import { useOrganizationBranding } from "@/hooks/useOrganizationBranding";
import { OrganizationSidebarLogo } from "@/components/OrganizationSidebarLogo";
import type { LocaleCode } from "@/i18n/messages";
import { isTenantAdmin } from "@/lib/authRole";
import { WavoipVoiceShell } from "@/components/wavoip/WavoipVoiceShell";
import { ThreeCxVoiceShell } from "@/components/threecx/ThreeCxVoiceShell";
import { NvoipVoiceShell } from "@/components/nvoip/NvoipVoiceShell";
import { WorkspaceRealtime } from "@/components/WorkspaceRealtime";
import { unlockAudioAlerts } from "@/lib/audioAlerts";

type SidebarTeam = { id: string; name: string; unseenTransferCount?: number };
type SidebarInbox = { id: string; name: string };

const navItems = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { to: "/reports", icon: BarChart3, labelKey: "nav.reports" },
  { to: "/ai-insights", icon: Brain, labelKey: "nav.aiInsights" },
  { to: "/conversations", icon: MessageSquare, labelKey: "nav.conversations" },
  { to: "/contacts", icon: Users, labelKey: "nav.contacts" },
  { to: "/crm", icon: LayoutGrid, labelKey: "nav.crm" },
  { to: "/deals", icon: Briefcase, labelKey: "nav.deals" },
  { to: "/reminders", icon: Bell, labelKey: "nav.reminders" },
] as const;

const SIDEBAR_COLLAPSED_STORAGE = "openconduit_sidebar_collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE) === "1";
  } catch {
    return false;
  }
}

export function Layout() {
  const { user, logout, exitUserImpersonation, refreshUser } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const orgLabel =
    user?.actingOrganization?.name ??
    user?.organization?.name ??
    (user?.role === "SUPER_ADMIN" ? "Console" : "—");
  const showCrmKanban = user?.organizationFeatures?.crm_kanban ?? true;
  const showDeals = user?.organizationFeatures?.crm_deals ?? true;
  const { badgeCount, alertPreviews, clearBadge, requestDesktopPermission } = useConversationAlerts();
  const [sidebarTeams, setSidebarTeams] = useState<SidebarTeam[]>([]);
  const [sidebarInboxes, setSidebarInboxes] = useState<SidebarInbox[]>([]);
  const [pilotFlags, setPilotFlags] = useState<{ assistantAiEnabled: boolean; aiPilotAccessEnabled: boolean } | null>(null);

  const showRemindersFeature = user?.organizationFeatures?.reminders !== false;
  const { reminders: actionableReminders, completingId, completeReminder } = useActionableReminders(
    !!user && showRemindersFeature,
  );
  const orgThemeKey = user?.actingOrganizationId ?? user?.organizationId ?? null;
  useConversationBubbleTheme(!!user, orgThemeKey);
  const { organizationLogoUrl, brandingReady } = useOrganizationBranding(!!user, orgThemeKey);

  useEffect(() => {
    if (orgLabel && orgLabel !== "—") {
      document.title = orgLabel;
    }
  }, [orgLabel]);

  useEffect(() => {
    if (!user?.actingOrganizationId) return;
    void refreshUser();
  }, [user?.actingOrganizationId, refreshUser]);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    void api
      .get<{ assistantAiEnabled: boolean; aiPilotAccessEnabled: boolean }>("/settings/pilot")
      .then((res) => {
        if (!cancelled) setPilotFlags(res);
      })
      .catch(() => {
        if (!cancelled) setPilotFlags({ assistantAiEnabled: true, aiPilotAccessEnabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assistantAiEnabled: boolean; aiPilotAccessEnabled: boolean } | undefined;
      if (!detail) return;
      setPilotFlags(detail);
    };
    window.addEventListener("openconduit:pilot-flags-updated", on as EventListener);
    return () => window.removeEventListener("openconduit:pilot-flags-updated", on as EventListener);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || !!el?.isContentEditable;
      if (typing) return;

      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        navigate("/conversations");
        return;
      }
      if (k === "v") {
        e.preventDefault();
        navigate("/contacts");
        return;
      }
      if (k === "r") {
        e.preventDefault();
        navigate("/reports");
        return;
      }
      if (k === "s") {
        if (!tenantAdmin) return;
        e.preventDefault();
        navigate("/settings");
        return;
      }
      if (k === "o") {
        e.preventDefault();
        setMobileNavOpen((v) => !v);
        return;
      }
      if (k === "m") {
        e.preventDefault();
        try {
          const storageKey = "openconduit_availability";
          const cur = localStorage.getItem(storageKey);
          const next = cur === "away" ? "online" : "away";
          localStorage.setItem(storageKey, next);
          window.dispatchEvent(new CustomEvent("openconduit:availability-changed"));
        } catch {
        }
        return;
      }
      if (k === "n") {
        if (!location.pathname.startsWith("/conversations")) return;
        e.preventDefault();
        const params = new URLSearchParams(location.search);
        const cur = params.get("status") || "";
        const cycle = ["OPEN", "PENDING", "RESOLVED", ""];
        const idx = Math.max(0, cycle.indexOf(cur));
        const next = cycle[(idx + 1) % cycle.length] || "";
        if (next) params.set("status", next);
        else params.delete("status");
        navigate(`/conversations?${params.toString()}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, location.pathname, location.search, tenantAdmin]);

  useEffect(() => {
    const on = () => {
      void unlockAudioAlerts();
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, []);

  const teamTransferTotalUnseen = useMemo(
    () => sidebarTeams.reduce((sum, t) => sum + (t.unseenTransferCount ?? 0), 0),
    [sidebarTeams],
  );

  /** Agentes membros de equipa precisam aceder ao centro de colaboração (não só admins). */
  const showTeamsNav = tenantAdmin || sidebarTeams.length > 0;

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
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

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

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const navItemClass = (active: boolean, collapsed: boolean) =>
    clsx(
      "flex min-h-11 items-center rounded text-sm font-medium transition-colors",
      collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
      active
        ? "nav-link-active"
        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
    );

  const teamNavItemClass = (active: boolean, collapsed: boolean) =>
    clsx(
      "flex min-h-11 items-center rounded py-2 text-sm font-medium transition-colors",
      collapsed ? "justify-center px-2" : "gap-2 pl-9 pr-3",
      active
        ? "nav-link-active"
        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
    );

  const navLinkClass = (isActive: boolean, collapsed: boolean) =>
    clsx(
      "flex min-h-11 items-center rounded text-sm font-medium transition-colors",
      collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
      isActive
        ? "nav-link-active"
        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
    );

  const unreadBadge = (count: number, collapsed: boolean) =>
    count > 0 ? (
      collapsed ? (
        <span
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600 ring-2 ring-white dark:ring-ink-950"
          title={t("nav.teamTransferUnreadBadge")}
          aria-label={`${t("nav.teamTransferUnreadBadge")}: ${count}`}
        />
      ) : (
        <span
          className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm"
          title={t("nav.teamTransferUnreadBadge")}
          aria-label={`${t("nav.teamTransferUnreadBadge")}: ${count}`}
        >
          {count > 99 ? "99+" : count}
        </span>
      )
    ) : null;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const renderSidebarContent = (collapsed: boolean, showCollapseToggle: boolean) => (
    <>
      <div
        className={clsx(
          "shrink-0 border-b border-ink-100 dark:border-white/5",
          collapsed ? "flex flex-col items-center gap-2 px-2 py-4" : "px-3 py-4",
        )}
      >
        <div className={clsx("flex w-full items-center", collapsed ? "justify-center" : "gap-1")}>
          <Link
            to="/"
            title={collapsed ? orgLabel : undefined}
            className={clsx(
              "flex min-w-0 items-center transition-colors",
              collapsed
                ? "justify-center rounded-xl bg-gradient-to-b from-brand-50/90 to-white p-2.5 shadow-sm ring-1 ring-brand-200/50 dark:from-brand-950/50 dark:to-ink-950 dark:ring-brand-500/25"
                : "min-w-0 flex-1 gap-3",
            )}
          >
            <OrganizationSidebarLogo
              organizationLogoUrl={organizationLogoUrl}
              brandingReady={brandingReady}
              alt={orgLabel}
              emphasized={collapsed}
            />
            {!collapsed ? (
              <span className="min-w-0 truncate text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">
                {orgLabel}
              </span>
            ) : null}
          </Link>
          {showCollapseToggle && !collapsed ? (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="btn-ghost h-9 w-9 shrink-0 text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100"
              aria-label={t("nav.collapseSidebar")}
              title={t("nav.collapseSidebar")}
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        {showCollapseToggle && collapsed ? (
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="btn-ghost h-9 w-9 text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100"
            aria-label={t("nav.expandSidebar")}
            title={t("nav.expandSidebar")}
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <nav
        className={clsx(
          "min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-4",
          collapsed ? "px-1.5" : "px-3",
        )}
      >
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
                  title={collapsed ? t("nav.conversations") : undefined}
                  className={navItemClass(
                    location.pathname === "/conversations" && !conversationTeamId && !conversationInboxId,
                    collapsed,
                  )}
                >
                  <span className="relative shrink-0">
                    <MessageSquare className="h-5 w-5" />
                    {collapsed ? unreadBadge(teamTransferTotalUnseen, true) : null}
                  </span>
                  {!collapsed ? <span className="min-w-0 flex-1">{t("nav.conversations")}</span> : null}
                  {!collapsed ? unreadBadge(teamTransferTotalUnseen, false) : null}
                </Link>
                {sidebarTeams.length > 0 ? (
                  <div className="mb-1 mt-0.5 space-y-0.5">
                    {!collapsed ? (
                      <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                        {t("nav.teamInboxes")}
                      </p>
                    ) : null}
                    {sidebarTeams.map((team) => {
                      const n = team.unseenTransferCount ?? 0;
                      return (
                        <Link
                          key={team.id}
                          to={`/conversations?teamId=${encodeURIComponent(team.id)}`}
                          className={teamNavItemClass(conversationTeamId === team.id && !conversationInboxId, collapsed)}
                          title={team.name}
                        >
                          <span className="relative shrink-0">
                            <MessageSquare className={clsx(collapsed ? "h-5 w-5" : "h-4 w-4 opacity-70")} />
                            {collapsed ? unreadBadge(n, true) : null}
                          </span>
                          {!collapsed ? <span className="min-w-0 flex-1 truncate">{team.name}</span> : null}
                          {!collapsed ? unreadBadge(n, false) : null}
                        </Link>
                      );
                    })}
                    {showTeamsNav ? (
                      <Link
                        to={
                          sidebarTeams.length === 1
                            ? `/teams?teamId=${encodeURIComponent(sidebarTeams[0]!.id)}`
                            : "/teams"
                        }
                        className={teamNavItemClass(location.pathname === "/teams", collapsed)}
                        title={t("nav.teamCollaboration")}
                      >
                        <UsersRound className={clsx("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4 opacity-70")} />
                        {!collapsed ? (
                          <span className="min-w-0 flex-1 truncate">{t("nav.teamCollaboration")}</span>
                        ) : null}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {sidebarInboxes.length > 0 ? (
                  <div className="mb-1 mt-0.5 space-y-0.5">
                    {!collapsed ? (
                      <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                        {t("nav.inboxShortcuts")}
                      </p>
                    ) : null}
                    {sidebarInboxes.map((inbox) => (
                      <Link
                        key={inbox.id}
                        to={`/conversations?inboxId=${encodeURIComponent(inbox.id)}`}
                        className={teamNavItemClass(conversationInboxId === inbox.id && !conversationTeamId, collapsed)}
                        title={inbox.name}
                      >
                        <Inbox className={clsx("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4 opacity-70")} />
                        {!collapsed ? <span className="min-w-0 truncate">{inbox.name}</span> : null}
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
                title={collapsed ? t(item.labelKey) : undefined}
                className={({ isActive }) => navLinkClass(isActive, collapsed)}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed ? <span className="min-w-0 truncate">{t(item.labelKey)}</span> : null}
              </NavLink>
            ),
          )}
        <NavLink
          to="/inboxes"
          title={collapsed ? t("nav.inboxes") : undefined}
          className={({ isActive }) => navLinkClass(isActive, collapsed)}
        >
          <Inbox className="h-5 w-5 shrink-0" />
          {!collapsed ? <span className="min-w-0 truncate">{t("nav.inboxes")}</span> : null}
        </NavLink>
        <NavLink
          to="/my-attendance"
          title={collapsed ? t("nav.myAttendance") : undefined}
          className={({ isActive }) => navLinkClass(isActive, collapsed)}
        >
          <ClipboardCheck className="h-5 w-5 shrink-0" />
          {!collapsed ? <span className="min-w-0 truncate">{t("nav.myAttendance")}</span> : null}
        </NavLink>
        {showTeamsNav ? (
          <NavLink
            to="/teams"
            title={collapsed ? t("nav.teams") : undefined}
            className={({ isActive }) => navLinkClass(isActive, collapsed)}
          >
            <UsersRound className="h-5 w-5 shrink-0" />
            {!collapsed ? <span className="min-w-0 truncate">{t("nav.teams")}</span> : null}
          </NavLink>
        ) : null}
        {tenantAdmin ? (
          <>
            <NavLink
              to="/conversation-audit"
              title={collapsed ? t("nav.conversationAudit") : undefined}
              className={({ isActive }) => navLinkClass(isActive, collapsed)}
            >
              <FileSearch className="h-5 w-5 shrink-0" />
              {!collapsed ? <span className="min-w-0 truncate">{t("nav.conversationAudit")}</span> : null}
            </NavLink>
            <NavLink
              to="/bots"
              title={collapsed ? t("nav.bots") : undefined}
              className={({ isActive }) => navLinkClass(isActive, collapsed)}
            >
              <Bot className="h-5 w-5 shrink-0" />
              {!collapsed ? <span className="min-w-0 truncate">{t("nav.bots")}</span> : null}
            </NavLink>
            <NavLink
              to="/broadcasts"
              title={collapsed ? t("nav.broadcast") : undefined}
              className={({ isActive }) => navLinkClass(isActive, collapsed)}
            >
              <Megaphone className="h-5 w-5 shrink-0" />
              {!collapsed ? <span className="min-w-0 truncate">{t("nav.broadcast")}</span> : null}
            </NavLink>
          </>
        ) : null}

        {tenantAdmin || pilotFlags?.aiPilotAccessEnabled ? (
          <NavLink
            to="/automation"
            title={collapsed ? t("nav.automation") : undefined}
            className={({ isActive }) => navLinkClass(isActive, collapsed)}
          >
            <Sparkles className="h-5 w-5 shrink-0" />
            {!collapsed ? <span className="min-w-0 truncate">{t("nav.automation")}</span> : null}
          </NavLink>
        ) : null}
      </nav>

      <div
        className={clsx(
          "shrink-0 border-t border-ink-200 dark:border-white/10",
          collapsed ? "flex flex-col items-center gap-2 p-2" : "space-y-2 p-3",
        )}
      >
        <div className={clsx("flex w-full", collapsed ? "flex-col items-center gap-2" : "items-end gap-2")}>
          <ConversationNotifyBell badgeCount={badgeCount} alertPreviews={alertPreviews} clearBadge={clearBadge} />
          {user ? (
            <UserProfileMenu
              user={user}
              onLogout={() => handleLogout()}
              className={collapsed ? "w-auto" : "min-w-0 flex-1"}
              compact={collapsed}
            />
          ) : null}
        </div>
        {typeof Notification !== "undefined" && Notification.permission === "default" ? (
          <button
            type="button"
            onClick={() => void requestDesktopPermission()}
            title={collapsed ? t("nav.enableDesktopNotifications") : undefined}
            className={clsx(
              "text-brand-600 hover:text-brand-800 dark:text-brand-400",
              collapsed
                ? "flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink-50 dark:hover:bg-ink-800"
                : "w-full rounded-lg py-1 text-center text-[11px]",
            )}
          >
            {collapsed ? <Bell className="h-4 w-4" /> : t("nav.enableDesktopNotifications")}
          </button>
        ) : null}
        {collapsed ? (
          <div className="relative">
            <label htmlFor="locale-collapsed" className="sr-only">
              {t("common.language")}
            </label>
            <select
              id="locale-collapsed"
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleCode)}
              title={t("common.language")}
              className="flex h-9 w-9 cursor-pointer appearance-none items-center justify-center rounded-lg border border-ink-100 bg-ink-50 text-transparent dark:border-white/10 dark:bg-white/5"
            >
              <option value="pt-BR">{t("common.ptBR")}</option>
              <option value="en">{t("common.en")}</option>
            </select>
            <Languages
              className="pointer-events-none absolute inset-0 m-auto h-4 w-4 text-ink-500 dark:text-ink-300"
              aria-hidden
            />
          </div>
        ) : (
          <div className="flex w-full items-center gap-2 rounded-lg border border-ink-100 bg-ink-50 px-2 py-1.5 dark:border-white/10 dark:bg-white/5">
            <Languages className="h-4 w-4 shrink-0 text-ink-500 dark:text-ink-300" />
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
        )}
      </div>
    </>
  );

  return (
    <WavoipVoiceShell>
    <ThreeCxVoiceShell>
    <NvoipVoiceShell>
    <div className="flex h-[100dvh] w-full max-w-[100vw] min-w-0 overflow-x-clip">
      <aside
        className={clsx(
          "hidden shrink-0 flex-col border-r border-ink-200 bg-white transition-[width] duration-200 ease-in-out dark:border-white/10 dark:bg-ink-950 lg:flex",
          sidebarCollapsed ? "w-[4.25rem]" : "w-64",
        )}
      >
        {renderSidebarContent(sidebarCollapsed, true)}
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t("common.close")}
          />
          <aside className="relative flex h-full w-80 max-w-[85vw] shrink-0 flex-col border-r border-ink-200 bg-white shadow-xl dark:border-white/10 dark:bg-ink-950">
            <div className="absolute right-2 top-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="btn-ghost h-11 w-11"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderSidebarContent(false, false)}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <div className="flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-3 dark:border-white/10 dark:bg-ink-950 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="btn-ghost h-11 w-11"
            aria-label={t("common.openMenu")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{orgLabel}</div>
          </div>
          <div className="flex items-center gap-2">
            <ConversationNotifyBell badgeCount={badgeCount} alertPreviews={alertPreviews} clearBadge={clearBadge} />
            {user ? (
              <UserProfileMenu user={user} onLogout={() => handleLogout()} className="min-w-0" />
            ) : null}
          </div>
        </div>
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
        {showRemindersFeature && actionableReminders.length > 0 ? (
          <ReminderActionableBanner
            reminders={actionableReminders}
            completingId={completingId}
            onComplete={(id) => void completeReminder(id)}
          />
        ) : null}
        <main className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-ink-50 dark:bg-transparent">
          <Outlet />
        </main>
      </div>
      <WorkspaceRealtime />
    </div>
    </NvoipVoiceShell>
    </ThreeCxVoiceShell>
    </WavoipVoiceShell>
  );
}
