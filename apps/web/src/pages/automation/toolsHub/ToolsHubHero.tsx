import { Link } from "react-router-dom";
import clsx from "clsx";
import { LayoutGrid, Plus, Sparkles, Terminal, Wrench } from "lucide-react";
import { HERO_DECOR_LOGOS } from "@/pages/automation/integrationVisualRegistry";

type HubTab = "marketplace" | "mine" | "create";

type ToolsHubHeroProps = {
  t: (key: string) => string;
  hubTab: HubTab;
  onTabChange: (tab: HubTab) => void;
  onCreateClick: () => void;
};

export function ToolsHubHero({ t, hubTab, onTabChange, onCreateClick }: ToolsHubHeroProps) {
  const tabs = [
    { id: "marketplace" as const, label: t("automationPage.toolsTabMarketplace"), icon: LayoutGrid },
    { id: "mine" as const, label: t("automationPage.toolsTabMine"), icon: Wrench },
    { id: "create" as const, label: t("automationPage.toolsTabCreate"), icon: Terminal },
  ];

  return (
    <section
      className={clsx(
        "relative overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-5 sm:p-6",
        "dark:border-soft-border-muted dark:bg-soft-surface-2",
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-500/[0.06] via-transparent to-violet-500/[0.04] dark:from-brand-500/10 dark:to-violet-900/10"
        aria-hidden
      />

      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl xl:pr-6">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t("automationPage.toolsHubBadge")}
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-[#0F172A] dark:text-soft-text sm:text-2xl">
            {t("automationPage.toolsHubTitleLead")}{" "}
            <span className="text-brand-600 dark:text-brand-300">{t("automationPage.toolsHubTitleAccent")}</span>
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#64748B] dark:text-soft-text-secondary">
            {t("automationPage.toolsHubSubtitle")}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col items-stretch gap-3 sm:items-end xl:w-auto xl:max-w-md">
          <div className="hidden flex-wrap items-center justify-end gap-2 xl:flex" aria-hidden>
            {HERO_DECOR_LOGOS.map((logo) => (
              <div
                key={logo.alt}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white p-1.5 shadow-sm dark:border-soft-border-muted dark:bg-soft-surface-3"
              >
                <img src={logo.logoUrl} alt="" className="h-6 w-6 object-contain" draggable={false} />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onCreateClick}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:w-auto xl:self-end"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("automationPage.toolsHubNewTool")}
          </button>
        </div>
      </div>

      <div className="relative mt-5 flex flex-wrap gap-1 rounded-[10px] border border-[#E5E7EB] bg-[#F8FAFC] p-1 dark:border-soft-border-muted dark:bg-soft-surface-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={clsx(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition sm:flex-none sm:px-4 sm:text-sm",
              hubTab === tab.id
                ? "bg-white text-brand-700 shadow-sm dark:bg-soft-surface-2 dark:text-brand-300"
                : "text-[#64748B] hover:text-[#0F172A] dark:text-soft-text-secondary dark:hover:text-soft-text",
            )}
          >
            <tab.icon className="h-4 w-4 opacity-80" aria-hidden />
            {tab.label}
          </button>
        ))}
      </div>
    </section>
  );
}

type ToolsHubHelpFooterProps = {
  t: (key: string) => string;
  supportUrl: string | null;
};

export function ToolsHubHelpFooter({ t, supportUrl }: ToolsHubHelpFooterProps) {
  return (
    <section className="rounded-xl border border-sky-200/80 bg-sky-50/70 p-5 dark:border-sky-900/40 dark:bg-sky-950/20">
      <p className="text-sm font-semibold text-[#0F172A] dark:text-soft-text">{t("automationPage.toolsHelpTitle")}</p>
      <p className="mt-1 text-sm text-[#64748B] dark:text-soft-text-secondary">{t("automationPage.toolsHelpBody")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/help/automation/tools"
          className="inline-flex items-center rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#0F172A] transition hover:border-brand-300 dark:border-soft-border-muted dark:bg-soft-surface-2 dark:text-soft-text"
        >
          {t("automationPage.toolsHelpCenter")}
        </Link>
        {supportUrl ? (
          <a
            href={supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
          >
            {t("automationPage.toolsHelpSupport")}
          </a>
        ) : null}
      </div>
    </section>
  );
}
