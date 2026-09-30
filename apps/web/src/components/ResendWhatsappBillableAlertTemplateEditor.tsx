import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildWhatsappBillableAlertEmailContent,
  DEFAULT_WHATSAPP_BILLABLE_ALERT_HTML,
  DEFAULT_WHATSAPP_BILLABLE_ALERT_SUBJECT,
  WHATSAPP_BILLABLE_ALERT_PREVIEW_SAMPLE,
} from "@openconduit/shared";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveLocalSystemLogoUrl } from "@/lib/systemLogoUrl";

const TOKENS = [
  "{{organizationName}}",
  "{{billableCount}}",
  "{{monthKey}}",
  "{{appName}}",
  "{{logoUrl}}",
  "{{logoHtml}}",
] as const;

function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  current: string,
  token: string,
  onChange: (next: string) => void,
): void {
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

export type ResendWhatsappBillableAlertTemplateEditorProps = {
  fromName: string;
  logoUrl?: string;
  resolvedLogoUrl?: string;
  subject: string;
  html: string;
  onSubjectChange: (v: string) => void;
  onHtmlChange: (v: string) => void;
};

export function ResendWhatsappBillableAlertTemplateEditor({
  fromName,
  logoUrl,
  resolvedLogoUrl,
  subject,
  html,
  onSubjectChange,
  onHtmlChange,
}: ResendWhatsappBillableAlertTemplateEditorProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => {
    const appName = fromName.trim() || "OpenNexo CRM";
    return buildWhatsappBillableAlertEmailContent(subject, html, {
      ...WHATSAPP_BILLABLE_ALERT_PREVIEW_SAMPLE,
      appName,
      logoUrl: resolveLocalSystemLogoUrl(logoUrl || resolvedLogoUrl),
    });
  }, [subject, html, fromName, logoUrl, resolvedLogoUrl]);

  const insertInSubject = useCallback(
    (token: string) => {
      const el = subjectInputRef.current;
      if (!el) {
        onSubjectChange(subject + token);
        return;
      }
      insertAtCursor(el, subject, token, onSubjectChange);
    },
    [subject, onSubjectChange],
  );

  const insertInHtml = useCallback(
    (token: string) => {
      const el = htmlTextareaRef.current;
      if (!el) {
        onHtmlChange(html + token);
        return;
      }
      insertAtCursor(el, html, token, onHtmlChange);
    },
    [html, onHtmlChange],
  );

  return (
    <div className="space-y-3 border-t border-ink-100 pt-4 dark:border-ink-700">
      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
        {t("superAdmin.resendWhatsappBillableAlertTemplateTitle")}
      </h3>
      <p className="text-xs text-ink-500 dark:text-ink-400">
        {t("superAdmin.resendWhatsappBillableAlertTemplateHint")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-200 p-0.5 dark:border-ink-600">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === "edit"
                ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900"
                : "text-ink-600 hover:bg-ink-50 dark:text-ink-400 dark:hover:bg-ink-800"
            }`}
            onClick={() => setTab("edit")}
          >
            {t("superAdmin.resendTemplateTabEdit")}
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === "preview"
                ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900"
                : "text-ink-600 hover:bg-ink-50 dark:text-ink-400 dark:hover:bg-ink-800"
            }`}
            onClick={() => setTab("preview")}
          >
            {t("superAdmin.resendTemplateTabPreview")}
          </button>
        </div>
      </div>
      {tab === "edit" ? (
        <>
          <div>
            <label className="block text-xs font-medium text-ink-600">{t("superAdmin.resendTemplateSubject")}</label>
            <input
              ref={subjectInputRef}
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder={DEFAULT_WHATSAPP_BILLABLE_ALERT_SUBJECT}
              className="input-field mt-1 font-mono text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  className="rounded border border-ink-200 px-2 py-0.5 font-mono text-[10px] text-ink-600 dark:border-ink-600 dark:text-ink-300"
                  onClick={() => insertInSubject(token)}
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-600">{t("superAdmin.resendTemplateHtml")}</label>
            <textarea
              ref={htmlTextareaRef}
              value={html}
              onChange={(e) => onHtmlChange(e.target.value)}
              rows={12}
              placeholder={DEFAULT_WHATSAPP_BILLABLE_ALERT_HTML.slice(0, 120) + "…"}
              className="input-field mt-1 font-mono text-xs"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {TOKENS.map((token) => (
                <button
                  key={`html-${token}`}
                  type="button"
                  className="rounded border border-ink-200 px-2 py-0.5 font-mono text-[10px] text-ink-600 dark:border-ink-600 dark:text-ink-300"
                  onClick={() => insertInHtml(token)}
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900">
          <p className="mb-2 text-xs font-medium text-ink-500">{preview.subject}</p>
          <iframe
            title="preview"
            sandbox=""
            className="h-64 w-full rounded border border-ink-100 dark:border-ink-800"
            srcDoc={preview.html}
          />
        </div>
      )}
    </div>
  );
}
