import { useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Check } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  buildSupportMessage,
  buildWhatsAppUrlFromPhone,
  type HelpCenterPublicConfig,
} from "@/lib/help/useHelpConfig";

type Props = {
  config: HelpCenterPublicConfig;
  contextLabel?: string | null;
  onBack: () => void;
};

export function HelpSupportPanel({ config, contextLabel, onBack }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { support } = config;

  const message = buildSupportMessage(
    support.whatsappMessage,
    contextLabel ? contextLabel : undefined,
  );

  const whatsappUrl = buildWhatsAppUrlFromPhone(support.phoneDisplay, message);

  const copyPhone = async () => {
    if (!support.phoneDisplay) return;
    try {
      await navigator.clipboard.writeText(support.phoneDisplay);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("help.modal.back")}
      </button>

      <div className="text-center">
        <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{support.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{support.description}</p>
      </div>

      <div className="rounded-xl border border-ink-200 bg-ink-50 p-4 dark:border-ink-700 dark:bg-ink-800/50">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("help.support.messageLabel")}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-ink-700 dark:text-ink-300">{message}</p>
      </div>

      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {t("help.support.openWhatsApp")}
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : (
        <p className="text-center text-sm text-amber-700 dark:text-amber-300">{t("help.support.phoneNotConfigured")}</p>
      )}

      {support.phoneDisplay ? (
        <div className="text-center">
          <p className="text-xs text-ink-500">{t("help.support.didNotOpen")}</p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2 dark:border-ink-600 dark:bg-ink-800">
            <span className="font-mono text-sm text-ink-800 dark:text-ink-100">{support.phoneDisplay}</span>
            <button
              type="button"
              onClick={() => void copyPhone()}
              className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-700"
              aria-label={t("help.support.copyPhone")}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
