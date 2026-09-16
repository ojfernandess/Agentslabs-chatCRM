import { useState } from "react";
import { CircleHelp, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { buildSetWebhookCurl } from "@/lib/inboxTelegramConfig";

const TELEGRAM_DOCS_URL = "https://core.telegram.org/bots/api#setwebhook";

type GuideContentProps = {
  webhookUrl?: string;
  botToken?: string;
  onCopy?: (text: string) => void | Promise<void>;
};

export function TelegramSetupGuideContent({ webhookUrl, botToken, onCopy }: GuideContentProps) {
  const { t } = useI18n();

  const copy = (text: string) => {
    if (onCopy) void onCopy(text);
    else void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const setWebhookCommand =
    webhookUrl && botToken?.trim() ? buildSetWebhookCurl(botToken, webhookUrl) : null;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.telegramInbox.guideIntro")}</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-xs text-ink-600 dark:text-ink-400">
        <li>{t("inboxesPage.wizard.telegramInbox.guideStep1")}</li>
        <li>{t("inboxesPage.wizard.telegramInbox.guideStep2")}</li>
        <li>{t("inboxesPage.wizard.telegramInbox.guideStep3")}</li>
        <li>{t("inboxesPage.wizard.telegramInbox.guideStep4")}</li>
        <li>{t("inboxesPage.wizard.telegramInbox.guideStep5")}</li>
      </ol>

      {webhookUrl ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
            {t("inboxesPage.wizard.telegramInbox.webhookUrlLabel")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
              {webhookUrl}
            </code>
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => copy(webhookUrl)}>
              {t("inboxesPage.wizard.ingestCopy")}
            </button>
          </div>
        </div>
      ) : null}

      {setWebhookCommand ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
            {t("inboxesPage.wizard.telegramInbox.setWebhookCommandLabel")}
          </p>
          <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-50 p-3 text-xs dark:bg-ink-950">
            {setWebhookCommand}
          </pre>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => copy(setWebhookCommand)}>
            {t("inboxesPage.wizard.ingestCopy")}
          </button>
        </div>
      ) : null}

      <p className="text-xs text-ink-500">
        <a
          href={TELEGRAM_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t("inboxesPage.wizard.telegramInbox.docsLink")}
        </a>
      </p>
    </div>
  );
}

/** Ícone minimalista — abre o guia rápido em modal. */
export function TelegramSetupGuideHint({
  webhookUrl,
  botToken,
  onCopy,
}: GuideContentProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={t("inboxesPage.wizard.telegramInbox.guideHintLabel")}
        title={t("inboxesPage.wizard.telegramInbox.guideHintLabel")}
        onClick={() => setOpen(true)}
        className="rounded-full p-0.5 text-ink-400 transition-colors hover:text-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 dark:hover:text-sky-400"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="telegram-setup-guide-title"
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-700">
              <h2 id="telegram-setup-guide-title" className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                {t("inboxesPage.wizard.telegramInbox.guideTitle")}
              </h2>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <TelegramSetupGuideContent webhookUrl={webhookUrl} botToken={botToken} onCopy={onCopy} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function TelegramInboundSetupPanel(props: GuideContentProps) {
  return <TelegramSetupGuideContent {...props} />;
}
