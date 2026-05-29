import type { ReactNode } from "react";
import clsx from "clsx";
import {
  Activity,
  BarChart3,
  Box,
  Building2,
  HardDrive,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  QrCode,
  ScrollText,
  Settings2,
  Shield,
  ToggleLeft,
  Users,
} from "lucide-react";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { useI18n } from "@/i18n/I18nProvider";

export type SuperSection =
  | "overview"
  | "usageMetrics"
  | "organizations"
  | "platformUsers"
  | "globalSettings"
  | "whatsappEmbedded"
  | "evolutionPlatform"
  | "evolutionGoPlatform"
  | "monitoring"
  | "platformApps"
  | "auditLog"
  | "conversationMedia"
  | "featureFlags";

type NavItem = { id: SuperSection; labelKey: string; icon: typeof LayoutDashboard };

const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: "superAdmin.navGroupPlatform",
    items: [
      { id: "overview", labelKey: "superAdmin.overview", icon: LayoutDashboard },
      { id: "usageMetrics", labelKey: "superAdmin.usageMetrics", icon: BarChart3 },
    ],
  },
  {
    labelKey: "superAdmin.navGroupTenants",
    items: [
      { id: "organizations", labelKey: "superAdmin.organizations", icon: Building2 },
      { id: "platformUsers", labelKey: "superAdmin.platformUsers", icon: Users },
    ],
  },
  {
    labelKey: "superAdmin.navGroupIntegrations",
    items: [
      { id: "whatsappEmbedded", labelKey: "superAdmin.whatsappEmbedded", icon: MessageCircle },
      { id: "evolutionPlatform", labelKey: "superAdmin.evolutionPlatform", icon: QrCode },
      { id: "evolutionGoPlatform", labelKey: "superAdmin.evolutionGoPlatform", icon: Settings2 },
    ],
  },
  {
    labelKey: "superAdmin.navGroupOperations",
    items: [
      { id: "monitoring", labelKey: "superAdmin.monitoring", icon: Activity },
      { id: "conversationMedia", labelKey: "superAdmin.conversationMedia.nav", icon: HardDrive },
      { id: "platformApps", labelKey: "superAdmin.platformApps", icon: Box },
      { id: "auditLog", labelKey: "superAdmin.auditLog", icon: ScrollText },
    ],
  },
  {
    labelKey: "superAdmin.navGroupGovernance",
    items: [
      { id: "globalSettings", labelKey: "superAdmin.globalSettings", icon: Settings2 },
      { id: "featureFlags", labelKey: "superAdmin.featureFlags", icon: ToggleLeft },
    ],
  },
];

const SECTION_TITLE_KEYS: Record<SuperSection, string> = {
  overview: "superAdmin.overview",
  usageMetrics: "superAdmin.usageMetrics",
  organizations: "superAdmin.organizations",
  platformUsers: "superAdmin.platformUsers",
  globalSettings: "superAdmin.globalSettings",
  whatsappEmbedded: "superAdmin.whatsappEmbedded",
  evolutionPlatform: "superAdmin.evolutionPlatform",
  evolutionGoPlatform: "superAdmin.evolutionGoPlatform",
  monitoring: "superAdmin.monitoring",
  platformApps: "superAdmin.platformApps",
  auditLog: "superAdmin.auditLog",
  conversationMedia: "superAdmin.conversationMedia.nav",
  featureFlags: "superAdmin.featureFlags",
};

const SECTION_SUBTITLE_KEYS: Partial<Record<SuperSection, string>> = {
  overview: "superAdmin.overviewSubtitle",
  usageMetrics: "superAdmin.usageMetricsSubtitle",
  organizations: "superAdmin.organizationsSubtitle",
  platformUsers: "superAdmin.platformUsersSubtitle",
  globalSettings: "superAdmin.globalSettingsSubtitle",
  monitoring: "superAdmin.monitoringSubtitle",
  auditLog: "superAdmin.auditSubtitle",
  conversationMedia: "superAdmin.conversationMedia.subtitle",
  featureFlags: "superAdmin.flagsSubtitle",
};

type SuperAdminShellProps = {
  section: SuperSection;
  onSectionChange: (id: SuperSection) => void;
  userEmail?: string;
  onLogout: () => void;
  error?: string;
  children: ReactNode;
};

export function SuperAdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Control plane</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SuperAdminMetricCard({
  label,
  value,
  hint,
  accent = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "default" | "violet" | "emerald" | "amber";
  className?: string;
}) {
  const accentRing =
    accent === "violet"
      ? "ring-violet-500/20"
      : accent === "emerald"
        ? "ring-emerald-500/20"
        : accent === "amber"
          ? "ring-amber-500/20"
          : "ring-slate-200/80";

  const accentGradient =
    accent === "violet"
      ? "from-violet-500/10"
      : accent === "emerald"
        ? "from-emerald-500/10"
        : accent === "amber"
          ? "from-amber-500/10"
          : "from-brand-500/8";

  return (
    <div className={clsx("relative overflow-hidden rounded-xl bg-white p-5 shadow-sm ring-1 ring-inset", accentRing, className)}>
      <div className={clsx("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", accentGradient)} />
      <div className="relative">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
        {hint ? <p className="mt-2 text-sm text-slate-600">{hint}</p> : null}
      </div>
    </div>
  );
}

export function SuperAdminPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SuperAdminShell({
  section,
  onSectionChange,
  userEmail,
  onLogout,
  error,
  children,
}: SuperAdminShellProps) {
  const { t } = useI18n();
  const sectionTitle = t(SECTION_TITLE_KEYS[section]);
  const sectionSubtitleKey = SECTION_SUBTITLE_KEYS[section];
  const sectionSubtitle = sectionSubtitleKey ? t(sectionSubtitleKey) : undefined;

  return (
    <div className="flex min-h-screen bg-[#f4f6fb] text-slate-900">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#0b1220] text-slate-200">
        <div className="border-b border-white/10 px-5 py-5">
          <img
            src={brandAssetUrl("/logo.svg")}
            alt=""
            className="h-10 w-auto max-w-[200px] object-contain"
            decoding="async"
          />
          <div className="mt-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/20 ring-1 ring-brand-400/30">
              <Shield className="h-4 w-4 text-brand-300" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {t("superAdmin.consoleBadge")}
              </p>
              <p className="truncate text-sm font-medium text-white">{t("superAdmin.consoleTitle")}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.labelKey}>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {t(group.labelKey)}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSectionChange(item.id)}
                        className={clsx(
                          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-white/10 font-medium text-white ring-1 ring-white/10"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                        )}
                      >
                        <Icon className={clsx("h-4 w-4 shrink-0", active ? "text-brand-300" : "text-slate-500")} />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          {userEmail ? (
            <p className="mb-3 truncate px-1 text-xs text-slate-500" title={userEmail}>
              {userEmail}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 px-6 backdrop-blur-md">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{sectionTitle}</p>
            {sectionSubtitle ? (
              <p className="truncate text-xs text-slate-500">{sectionSubtitle}</p>
            ) : (
              <p className="text-xs text-slate-500">{t("superAdmin.consoleSubtitle")}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/20 sm:inline">
              {t("superAdmin.envProduction")}
            </span>
          </div>
        </header>

        <main className="relative flex-1 overflow-auto">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            aria-hidden
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgb(148 163 184 / 0.15) 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-500/[0.04] via-transparent to-violet-500/[0.05]"
            aria-hidden
          />
          <div className="relative mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">
            {error ? (
              <div
                className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
