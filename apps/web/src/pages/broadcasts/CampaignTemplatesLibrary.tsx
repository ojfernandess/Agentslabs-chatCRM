import { useI18n } from "@/i18n/I18nProvider";
import { CAMPAIGN_TEMPLATE_PRESETS } from "./campaignTypes";

interface Props {
  onUseTemplate: (presetId: string, suggestedName: string, suggestedBody: string) => void;
}

export function CampaignTemplatesLibrary({ onUseTemplate }: Props) {
  const { t } = useI18n();

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CAMPAIGN_TEMPLATE_PRESETS.map((preset) => (
        <article
          key={preset.id}
          className="flex flex-col rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55"
        >
          <span className="text-2xl">{preset.emoji}</span>
          <h3 className="mt-2 text-sm font-bold text-ink-900 dark:text-ink-50">{t(preset.titleKey)}</h3>
          <p className="mt-1 flex-1 text-xs text-ink-600 dark:text-ink-400">{t(preset.descKey)}</p>
          <button
            type="button"
            onClick={() => onUseTemplate(preset.id, t(preset.titleKey), t(preset.messageHintKey))}
            className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-100"
          >
            {t("broadcastPage.useTemplate")}
          </button>
        </article>
      ))}
    </div>
  );
}
