import { useEffect, useState } from "react";
import clsx from "clsx";
import { Mail, Send, X } from "lucide-react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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
  const [toEmail, setToEmail] = useState("");
  const [toName, setToName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setToEmail("");
      setToName("");
      setSubject("");
      setBody("");
      setError(null);
      setSending(false);
    }
  }, [open]);

  const canSend =
    smtpReady &&
    isValidEmail(toEmail) &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.post<{ conversationId: string }>(`/inboxes/${inboxId}/compose-email`, {
        toEmail: toEmail.trim(),
        toName: toName.trim() || undefined,
        subject: subject.trim(),
        body: body.trim(),
      });
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                    {t("inboxesPage.emailWorkspace.composeToEmail")}
                  </span>
                  <input
                    type="email"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                    className="input-field"
                    placeholder="cliente@empresa.com"
                    autoComplete="email"
                  />
                </label>
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

              {error ? (
                <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-4 dark:border-ink-800">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={sending}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={clsx("btn-primary inline-flex items-center gap-2", !canSend && "opacity-50")}
                disabled={!canSend}
                onClick={() => void handleSend()}
              >
                <Send className="h-4 w-4" />
                {sending ? t("inboxesPage.emailWorkspace.composeSending") : t("inboxesPage.emailWorkspace.composeSend")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
