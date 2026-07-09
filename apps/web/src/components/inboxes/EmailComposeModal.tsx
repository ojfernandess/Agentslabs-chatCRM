import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, Mail, Paperclip, Send, X } from "lucide-react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  EmailRecipientFields,
  emailRecipientsPayload,
  hasValidEmailTo,
  type EmailRecipientFieldsValue,
} from "@/components/inboxes/EmailRecipientFields";

const emptyRecipients = (): EmailRecipientFieldsValue => ({ to: [], cc: [], bcc: [] });

export function EmailComposeModal({
  open,
  inboxId,
  fromAddress,
  smtpReady,
  onClose,
  onSent,
}: {
  open: boolean;
  inboxId: string;
  fromAddress?: string;
  smtpReady: boolean;
  onClose: () => void;
  onSent: (conversationId: string) => void;
}) {
  const { t } = useI18n();
  const [recipients, setRecipients] = useState<EmailRecipientFieldsValue>(emptyRecipients);
  const [toName, setToName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setRecipients(emptyRecipients());
      setToName("");
      setSubject("");
      setBody("");
      setPendingFiles([]);
      setError(null);
      setSending(false);
    }
  }, [open]);

  const canSend =
    smtpReady &&
    hasValidEmailTo(recipients) &&
    subject.trim().length > 0 &&
    (body.trim().length > 0 || pendingFiles.length > 0) &&
    !sending;

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const trimmedSubject = subject.trim();
      const trimmedBody = body.trim();
      const recipientPayload = emailRecipientsPayload(recipients);
      const res = await api.post<{ conversationId: string; contactId: string }>(
        `/inboxes/${inboxId}/compose-email`,
        {
          toEmails: recipients.to,
          toName: toName.trim() || undefined,
          ...(recipients.cc.length > 0 ? { cc: recipients.cc } : {}),
          ...(recipients.bcc.length > 0 ? { bcc: recipients.bcc } : {}),
          subject: trimmedSubject,
          body: trimmedBody || "(anexo)",
        },
      );

      for (const file of pendingFiles) {
        const kind: "IMAGE" | "DOCUMENT" = file.type.startsWith("image/") ? "IMAGE" : "DOCUMENT";
        const { mediaUrl, mimeType } = await api.uploadMessageMedia(file);
        await api.post("/messages", {
          contactId: res.contactId,
          conversationId: res.conversationId,
          inboxId,
          type: kind,
          mediaUrl,
          mediaType: mimeType,
          emailSubject: trimmedSubject,
          ...recipientPayload,
        });
      }

      onSent(res.conversationId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inboxesPage.emailWorkspace.composeSendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 dark:bg-black/60"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-amber-200/80 bg-white shadow-2xl dark:border-amber-900/40 dark:bg-[#0F1B2B]"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-white px-5 py-4 dark:border-amber-900/30 dark:from-amber-950/30 dark:to-[#0F1B2B]">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
                  <Mail className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">
                    {t("inboxesPage.emailWorkspace.composeTitle")}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {fromAddress
                      ? t("inboxesPage.emailWorkspace.composeFromHint").replace("{from}", fromAddress)
                      : t("inboxesPage.emailWorkspace.composeFromHintGeneric")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {!smtpReady ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {t("inboxesPage.emailWorkspace.composeSmtpRequired")}
                </p>
              ) : null}

              <EmailRecipientFields
                value={recipients}
                onChange={setRecipients}
                disabled={sending}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                    {t("inboxesPage.emailWorkspace.composeToName")}
                  </span>
                  <input
                    type="text"
                    value={toName}
                    onChange={(e) => setToName(e.target.value)}
                    className="input-field"
                    placeholder={t("inboxesPage.emailWorkspace.composeToNamePlaceholder")}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                    {t("inboxesPage.emailWorkspace.composeSubject")}
                  </span>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="input-field"
                    placeholder={t("inboxesPage.emailWorkspace.composeSubjectPlaceholder")}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                  {t("inboxesPage.emailWorkspace.composeBody")}
                </span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="input-field min-h-[10rem] resize-y"
                  placeholder={t("inboxesPage.emailWorkspace.composeBodyPlaceholder")}
                />
              </label>

              {pendingFiles.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {pendingFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2 py-1 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="rounded p-0.5 hover:bg-ink-200 dark:hover:bg-ink-700"
                        aria-label={t("inboxesPage.emailWorkspace.composeRemoveAttachment")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 dark:border-ink-800">
              <div className="flex items-center gap-1">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                  title={t("inboxesPage.emailWorkspace.composeAttachImage")}
                >
                  <ImagePlus className="h-4 w-4" />
                  {t("inboxesPage.emailWorkspace.composeAttachImage")}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                  title={t("inboxesPage.emailWorkspace.composeAttachFile")}
                >
                  <Paperclip className="h-4 w-4" />
                  {t("inboxesPage.emailWorkspace.composeAttachFile")}
                </button>
              </div>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void handleSend()}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition",
                  canSend
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "cursor-not-allowed bg-ink-300 dark:bg-ink-700",
                )}
              >
                <Send className="h-4 w-4" />
                {sending
                  ? t("inboxesPage.emailWorkspace.composeSending")
                  : t("inboxesPage.emailWorkspace.composeSend")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
