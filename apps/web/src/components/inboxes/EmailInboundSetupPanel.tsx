import { useI18n } from "@/i18n/I18nProvider";
import { emailInboundJsonExample } from "@/lib/inboxEmailConfig";

type Props = {
  inboundUrl: string;
  fromAddress?: string;
  onCopy?: (text: string) => void | Promise<void>;
};

export function EmailInboundSetupPanel({ inboundUrl, fromAddress, onCopy }: Props) {
  const { t } = useI18n();
  const exampleJson = emailInboundJsonExample(fromAddress);

  const copy = (text: string) => {
    if (onCopy) void onCopy(text);
    else void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.emailInbox.inboundIntro")}</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-600 dark:text-ink-400">
        <li>{t("inboxesPage.wizard.emailInbox.inboundStep1")}</li>
        <li>{t("inboxesPage.wizard.emailInbox.inboundStep2")}</li>
        <li>{t("inboxesPage.wizard.emailInbox.inboundStep3")}</li>
      </ol>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
          {t("inboxesPage.wizard.emailInbox.inboundUrlLabel")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
            {inboundUrl}
          </code>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => copy(inboundUrl)}>
            {t("inboxesPage.wizard.ingestCopy")}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
          {t("inboxesPage.wizard.emailInbox.inboundJsonExampleLabel")}
        </p>
        <pre className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-50 p-3 text-xs dark:bg-ink-950">
          {exampleJson}
        </pre>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => copy(exampleJson)}>
          {t("inboxesPage.wizard.ingestCopy")}
        </button>
      </div>
    </div>
  );
}
