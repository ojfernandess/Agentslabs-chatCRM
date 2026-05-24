import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildUserInviteEmailContent,
  DEFAULT_USER_INVITE_HTML,
  DEFAULT_USER_INVITE_SUBJECT,
  USER_INVITE_PREVIEW_SAMPLE,
} from "@openconduit/shared";
import { useI18n } from "@/i18n/I18nProvider";

const TOKENS = [
  "{{inviteUrl}}",
  "{{inviteUrlText}}",
  "{{userName}}",
  "{{organizationName}}",
  "{{appName}}",
  "{{logoUrl}}",
  "{{logoHtml}}",
] as const;

const PREVIEW_LOGO = "https://app.exemplo.com/logo.svg";

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

export type ResendUserInviteTemplateEditorProps = {
  fromName: string;
  logoUrl?: string;
  subject: string;
  html: string;
  onSubjectChange: (v: string) => void;
  onHtmlChange: (v: string) => void;
};

export function ResendUserInviteTemplateEditor({
  fromName,
  logoUrl,
  subject,
  html,
  onSubjectChange,
  onHtmlChange,
}: ResendUserInviteTemplateEditorProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => {
    const appName = fromName.trim() || "OpenNexo CRM";
    return buildUserInviteEmailContent(subject, html, {
      ...USER_INVITE_PREVIEW_SAMPLE,
      appName,
      logoUrl: logoUrl?.trim() || PREVIEW_LOGO,
    });
  }, [subject, html, fromName, logoUrl]);

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
        <button
          type="button"
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          onClick={() => {
            onSubjectChange(DEFAULT_USER_INVITE_SUBJECT);
            onHtmlChange(DEFAULT_USER_INVITE_HTML);
          }}
        >
          {t("superAdmin.resendTemplateRestoreDefaults")}
        </button>
      </div>

      {tab === "edit" ? (
        <>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-ink-900">{t("superAdmin.resendUserInviteSubject")}</h3>
            <p className="mb-2 text-xs text-ink-500">{t("superAdmin.resendUserInvitePlaceholders")}</p>
            <input
              ref={subjectInputRef}
              type="text"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              className="input-field mb-2 w-full"
              maxLength={200}
              autoComplete="off"
            />
            <p className="mb-1 text-xs font-medium text-ink-600">{t("superAdmin.resendTemplateInsertLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {TOKENS.map((token) => (
                <button
                  key={`s-${token}`}
                  type="button"
                  className="rounded border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-[11px] text-ink-800 hover:bg-ink-100 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                  onClick={() => insertInSubject(token)}
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-ink-900">{t("superAdmin.resendUserInviteHtml")}</h3>
            <textarea
              ref={htmlTextareaRef}
              value={html}
              onChange={(e) => onHtmlChange(e.target.value)}
              rows={14}
              spellCheck={false}
              className="input-field mb-2 w-full font-mono text-xs"
            />
            <p className="mb-1 text-xs font-medium text-ink-600">{t("superAdmin.resendTemplateInsertLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {TOKENS.map((token) => (
                <button
                  key={`h-${token}`}
                  type="button"
                  className="rounded border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-[11px] text-ink-800 hover:bg-ink-100 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                  onClick={() => insertInHtml(token)}
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{t("superAdmin.resendTemplatePreviewNote")}</p>
          <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 dark:border-ink-600 dark:bg-ink-800/50">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">{t("superAdmin.resendTemplatePreviewSubject")}</p>
            <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{preview.subject}</p>
          </div>
          <iframe
            title={t("superAdmin.resendTemplateTabPreview")}
            sandbox=""
            srcDoc={preview.html}
            className="h-[min(520px,70vh)] w-full rounded-lg border border-ink-200 bg-white dark:border-ink-600"
          />
        </div>
      )}
    </div>
  );
}
