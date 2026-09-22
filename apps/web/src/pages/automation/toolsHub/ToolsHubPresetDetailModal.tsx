import clsx from "clsx";
import type { ToolPresetMeta } from "@/pages/automation/automationToolTypes";
import { IntegrationBrandLogo } from "@/pages/automation/IntegrationBrandLogo";
import type { IntegrationVisual } from "@/pages/automation/integrationVisualRegistry";

type ToolsHubPresetDetailModalProps = {
  open: boolean;
  preset: ToolPresetMeta | null;
  visual: IntegrationVisual | null;
  installed: boolean;
  categoryLabel: string;
  t: (key: string) => string;
  loading: boolean;
  onClose: () => void;
  onInstall: () => void;
  onConfigure: () => void;
};

export function ToolsHubPresetDetailModal({
  open,
  preset,
  visual,
  installed,
  categoryLabel,
  t,
  loading,
  onClose,
  onInstall,
  onConfigure,
}: ToolsHubPresetDetailModalProps) {
  if (!open || !preset || !visual) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-preset-detail-title"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-2xl dark:border-soft-border-muted dark:bg-soft-surface-2"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4 dark:border-soft-border-muted">
          <div className="flex items-start gap-3">
            <IntegrationBrandLogo visual={visual} />
            <div>
              <h3 id="tools-preset-detail-title" className="text-base font-semibold text-[#0F172A] dark:text-soft-text">
                {visual.displayName}
              </h3>
              {visual.provider ? (
                <p className="text-xs text-[#64748B] dark:text-soft-text-secondary">{visual.provider}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#64748B] hover:bg-[#F8FAFC] dark:text-soft-text-secondary dark:hover:bg-soft-surface-3"
            aria-label={t("automationPage.cancel")}
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-[#64748B] dark:text-soft-text-secondary">{preset.description}</p>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-[#F8FAFC] p-3 dark:bg-soft-surface-3">
              <dt className="font-semibold uppercase tracking-wide text-[#94A3B8]">{t("automationPage.toolsDetailCategory")}</dt>
              <dd className="mt-1 font-medium text-[#0F172A] dark:text-soft-text">{categoryLabel}</dd>
            </div>
            <div className="rounded-lg bg-[#F8FAFC] p-3 dark:bg-soft-surface-3">
              <dt className="font-semibold uppercase tracking-wide text-[#94A3B8]">{t("automationPage.toolsDetailType")}</dt>
              <dd className="mt-1 font-medium text-[#0F172A] dark:text-soft-text">{preset.toolType}</dd>
            </div>
            <div className="rounded-lg bg-[#F8FAFC] p-3 dark:bg-soft-surface-3">
              <dt className="font-semibold uppercase tracking-wide text-[#94A3B8]">{t("automationPage.toolsDetailStatus")}</dt>
              <dd className="mt-1 font-medium text-[#0F172A] dark:text-soft-text">
                {installed ? t("automationPage.toolInstalled") : t("automationPage.toolsStatusAvailable")}
              </dd>
            </div>
            <div className="rounded-lg bg-[#F8FAFC] p-3 dark:bg-soft-surface-3">
              <dt className="font-semibold uppercase tracking-wide text-[#94A3B8]">{t("automationPage.toolsDetailKey")}</dt>
              <dd className="mt-1 break-all font-mono text-[11px] text-[#64748B] dark:text-soft-text-secondary">{preset.presetKey}</dd>
            </div>
          </dl>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4 dark:border-soft-border-muted">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-[#E5E7EB] px-4 py-2 text-xs font-semibold dark:border-soft-border-muted"
          >
            {t("automationPage.cancel")}
          </button>
          {installed ? (
            <button
              type="button"
              onClick={onConfigure}
              className="rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500"
            >
              {t("automationPage.toolsConfigure")}
            </button>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={onInstall}
              className={clsx(
                "rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500",
                loading && "opacity-50",
              )}
            >
              {t("automationPage.toolInstall")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
