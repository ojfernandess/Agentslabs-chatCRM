import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function WhatsAppMetaWebhookCopyPanel({
  webhookUrl,
  verifyToken,
  onRegenerateVerifyToken,
  regenerating,
  className = "",
}: {
  webhookUrl: string;
  verifyToken: string;
  onRegenerateVerifyToken?: () => void;
  regenerating?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const copy = async (text: string, which: "url" | "token") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (which === "url") {
        setCopiedUrl(true);
        window.setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        setCopiedToken(true);
        window.setTimeout(() => setCopiedToken(false), 2000);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={className}>
      <p className="mb-4 text-sm text-ink-600 dark:text-ink-300">
        {t("inboxesPage.wizard.whatsappMeta.webhookSetupIntro")}
      </p>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
            {t("inboxesPage.wizard.whatsappMeta.webhookUrlLabel")}
          </label>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-800 dark:border-ink-600 dark:bg-ink-950 dark:text-emerald-200/90">
              {webhookUrl || "—"}
            </code>
            <button
              type="button"
              onClick={() => void copy(webhookUrl, "url")}
              disabled={!webhookUrl}
              className="btn-secondary shrink-0 px-3"
              aria-label={t("inboxesPage.wizard.ingestCopy")}
            >
              {copiedUrl ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">{t("inboxesPage.wizard.ingestCopy")}</span>
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
            {t("inboxesPage.wizard.whatsappMeta.webhookVerifyTokenLabel")}
          </label>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-800 dark:border-ink-600 dark:bg-ink-950 dark:text-emerald-200/90">
              {verifyToken || "—"}
            </code>
            <button
              type="button"
              onClick={() => void copy(verifyToken, "token")}
              disabled={!verifyToken}
              className="btn-secondary shrink-0 px-3"
              aria-label={t("inboxesPage.wizard.ingestCopy")}
            >
              {copiedToken ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">{t("inboxesPage.wizard.ingestCopy")}</span>
            </button>
          </div>
          {onRegenerateVerifyToken ? (
            <button
              type="button"
              onClick={onRegenerateVerifyToken}
              disabled={regenerating}
              className="mt-2 text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
            >
              {t("inboxesPage.wizard.whatsappMeta.regenerateVerifyToken")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
