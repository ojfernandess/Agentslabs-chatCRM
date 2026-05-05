import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  LayoutGrid,
  Bell,
  Settings,
  LogOut,
  Languages,
  Shield,
} from "lucide-react";
import clsx from "clsx";
import { ConversationNotifyBell } from "@/components/ConversationNotifyBell";
import type { LocaleCode } from "@/i18n/messages";
import { isSuperAdminRole } from "@/lib/authRole";
const navItems = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { to: "/conversations", icon: MessageSquare, labelKey: "nav.conversations" },
  { to: "/contacts", icon: Users, labelKey: "nav.contacts" },
  { to: "/crm", icon: LayoutGrid, labelKey: "nav.crm" },
  { to: "/reminders", icon: Bell, labelKey: "nav.reminders" },
  { to: "/settings", icon: Settings, labelKey: "nav.settings" },
] as const;

export function Layout() {
  const { user, logout, exitOrganization } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-6">
          <img src="/logo.svg" alt="OpenConduit" className="h-7" />
          <span className="text-lg font-bold text-gray-900">OpenConduit</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {t(item.labelKey)}
            </NavLink>
          ))}
          {isSuperAdminRole(user?.role) && (
            <NavLink
              to="/super"
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                )
              }
            >
              <Shield className="h-5 w-5" />
              {t("nav.superAdmin")}
            </NavLink>
          )}
        </nav>

        <ConversationNotifyBell />

        <div className="border-t border-gray-200 p-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
            <Languages className="h-4 w-4 shrink-0 text-gray-500" />
            <label htmlFor="locale" className="sr-only">
              {t("common.language")}
            </label>
            <select
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleCode)}
              className="w-full min-w-0 flex-1 border-0 bg-transparent text-xs font-medium text-gray-700 focus:ring-0"
            >
              <option value="pt-BR">{t("common.ptBR")}</option>
              <option value="en">{t("common.en")}</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="truncate text-xs text-gray-500">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title={t("nav.logout")}
              type="button"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {isSuperAdminRole(user?.role) && user?.actingOrganizationId ? (
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
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-950 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100"
            >
              {t("common.backToSuperAdmin")}
            </button>
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-auto bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
