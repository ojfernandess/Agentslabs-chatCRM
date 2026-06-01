import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export function ContactNvoipSmsModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: { id: string; name: string; phone: string } | null;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [flashSms, setFlashSms] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setFlashSms(false);
    setError(null);
    setOk(false);
  }, [open, contact?.id]);

  const send = async () => {
    if (!contact) return;
    const text = message.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/contacts/${contact.id}/nvoip/sms`, {
        message: text,
        flashSms,
      });
      setOk(true);
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.sms.sendError"));
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && contact ? (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <div
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-ink-800 dark:bg-ink-950"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-ink-50">
                <MessageSquare className="h-5 w-5" />
                {t("nvoip.sms.modalTitle")}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {contact.name} · {contact.phone}
              </p>
              <p className="mt-2 text-xs text-slate-400">{t("nvoip.sms.modalHint")}</p>
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
              {ok ? <p className="mt-2 text-sm text-emerald-600">{t("nvoip.sms.sendSuccess")}</p> : null}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={160}
                rows={4}
                className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder={t("nvoip.sms.messagePlaceholder")}
              />
              <p className="mt-1 text-right text-xs text-slate-400">{message.length}/160</p>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={flashSms}
                  onChange={(e) => setFlashSms(e.target.checked)}
                />
                {t("nvoip.sms.flash")}
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn-ghost text-sm" onClick={onClose}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={sending || !message.trim()}
                  onClick={() => void send()}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.sms.send")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
