import clsx from "clsx";
import { ChevronRight, Heart, Plus } from "lucide-react";
import type { ToolPresetMeta } from "@/pages/automation/automationToolTypes";
import { IntegrationBrandLogo } from "@/pages/automation/IntegrationBrandLogo";
import { resolveIntegrationVisual } from "@/pages/automation/integrationVisualRegistry";

type ToolsHubMarketplaceCardProps = {
  preset: ToolPresetMeta;
  installed: boolean;
  favorite: boolean;
  categoryLabel: string;
  visual: ReturnType<typeof resolveIntegrationVisual>;
  loading: boolean;
  t: (key: string) => string;
  onToggleFavorite: () => void;
  onInstall: () => void;
  onConfigure: () => void;
  onViewDetails: () => void;
};

export function ToolsHubMarketplaceCard({
  preset,
  installed,
  favorite,
  categoryLabel,
  visual,
  loading,
  t,
  onToggleFavorite,
  onInstall,
  onConfigure,
  onViewDetails,
}: ToolsHubMarketplaceCardProps) {
  return (
    <article
      className={clsx(
        "group flex h-full flex-col rounded-xl border border-[#E5E7EB] bg-white p-5 transition duration-150",
        "hover:border-brand-300 hover:shadow-md hover:shadow-brand-500/5",
        "dark:border-soft-border-muted dark:bg-soft-surface-2 dark:hover:border-brand-500/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <IntegrationBrandLogo visual={visual} />
        <button
          type="button"
          onClick={onToggleFavorite}
          className={clsx(
            "rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            favorite
              ? "text-brand-600 dark:text-brand-300"
              : "text-[#94A3B8] hover:bg-[#F8FAFC] dark:text-soft-text-tertiary dark:hover:bg-soft-surface-3",
          )}
          title={t("automationPage.toolsFavorite")}
          aria-label={t("automationPage.toolsFavorite")}
        >
          <Heart className={clsx("h-4 w-4", favorite && "fill-current")} aria-hidden />
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1">
        <h3 className="text-sm font-semibold text-[#0F172A] dark:text-soft-text">{visual.displayName}</h3>
        {visual.provider ? (
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-[#94A3B8] dark:text-soft-text-tertiary">
            {visual.provider}
          </p>
        ) : null}
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[#64748B] dark:text-soft-text-secondary">
          {preset.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#64748B] dark:bg-soft-surface-3 dark:text-soft-text-secondary">
            {categoryLabel}
          </span>
          <span className="rounded-md bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-medium text-[#94A3B8] dark:bg-soft-surface-3 dark:text-soft-text-tertiary">
            {preset.toolType}
          </span>
          {installed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <span aria-hidden>✓</span>
              {t("automationPage.toolInstalled")}
            </span>
          ) : (
            <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#64748B] dark:bg-soft-surface-3 dark:text-soft-text-secondary">
              {t("automationPage.toolsStatusAvailable")}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#F1F5F9] pt-4 dark:border-soft-border-muted">
        {installed ? (
          <button
            type="button"
            onClick={onConfigure}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-[10px] bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-500"
          >
            {t("automationPage.toolsConfigure")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={onInstall}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-[10px] bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {t("automationPage.toolInstall")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onViewDetails}
          className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
        >
          {t("automationPage.toolsViewDetails")}
        </button>
      </div>
    </article>
  );
}

type ToolsHubSuggestCardProps = {
  t: (key: string) => string;
  supportUrl: string | null;
};

export function ToolsHubSuggestCard({ t, supportUrl }: ToolsHubSuggestCardProps) {
  return (
    <article className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-brand-300 bg-brand-50/40 p-6 text-center dark:border-brand-500/30 dark:bg-brand-950/20">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-600 dark:border-brand-500/30 dark:bg-soft-surface-2 dark:text-brand-300">
        <Plus className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-[#0F172A] dark:text-soft-text">{t("automationPage.toolsSuggestTitle")}</h3>
      <p className="mt-2 text-xs leading-relaxed text-[#64748B] dark:text-soft-text-secondary">
        {t("automationPage.toolsSuggestBody")}
      </p>
      {supportUrl ? (
        <a
          href={supportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center rounded-[10px] border border-brand-300 bg-white px-4 py-2 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 dark:border-brand-500/30 dark:bg-soft-surface-2 dark:text-brand-200"
        >
          {t("automationPage.toolsSuggestCta")}
        </a>
      ) : null}
    </article>
  );
}
