import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Globe, Loader2, RefreshCcw, Send, Trash2, X } from "lucide-react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";

/**
 * «Continuar no Web Chat» — modal compacto do atendente dentro da conversa.
 * O link é sempre gerado pelo backend (generate_webchat_link); a URL nunca é montada no frontend.
 * Renderizado em portal no document.body para não ficar clipado pelo overflow da conversa.
 */

type ActiveLink = {
  url: string;
  expiresAt: string | null;
};

function pickGeneratedLink(raw: unknown): ActiveLink | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" && o.url.trim() ? o.url.trim() : null;
  if (!url) return null;
  const expiresAt = typeof o.expiresAt === "string" && o.expiresAt ? o.expiresAt : null;
  return { url, expiresAt };
}

export function WebchatLinkModal({
  open,
  conversationId,
  onClose,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { t, locale } = useI18n();
  const localeTag = locale === "pt-BR" ? "pt-BR" : "en";
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<ActiveLink | null>(null);
  const [reused, setReused] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (regenerate = false) => {
      setLoading(true);
      setError(null);
      setSentOk(false);
      try {
        const r = await api.post<unknown>(`/webchat/conversations/${conversationId}/link`, {
          regenerate,
        });
        const picked = pickGeneratedLink(r);
        if (!picked) {
          setError(t("webchatLink.genericError"));
          return;
        }
        setLink(picked);
        setReused(Boolean((r as { reused?: boolean }).reused));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("webchatLink.genericError"));
      } finally {
        setLoading(false);
      }
    },
    [conversationId, t],
  );

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setSentOk(false);
    setLink(null);
    setError(null);
    void generate(false);
  }, [open, generate]);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard indisponível */
    }
  }, [link]);

  const sendToCustomer = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      await api.post(`/webchat/conversations/${conversationId}/link/send`, { regenerate: true });
      setSentOk(true);
      onSent?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("webchatLink.genericError"));
    } finally {
      setSending(false);
    }
  }, [conversationId, onSent, t]);

  const revoke = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.delete(`/webchat/conversations/${conversationId}/link`);
      setLink(null);
      setSentOk(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("webchatLink.genericError"));
    } finally {
      setLoading(false);
    }
  }, [conversationId, t]);

  const expiresLabel =
    link?.expiresAt && !Number.isNaN(new Date(link.expiresAt).getTime())
      ? new Date(link.expiresAt).toLocaleString(localeTag, {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-ink-900"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("webchatLink.title")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                  <Globe className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-ink-900 dark:text-ink-100">
                    {t("webchatLink.title")}
                  </h2>
                  <p className="text-xs text-ink-500">{t("webchatLink.subtitle")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loading && !link ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-ink-200 py-6 text-sm text-ink-500 dark:border-ink-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("webchatLink.generating")}
                </div>
              ) : null}

              {link ? (
                <>
                  <div className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2.5 dark:border-ink-700 dark:bg-ink-950">
                    <p className="break-all font-mono text-xs text-ink-800 dark:text-ink-200">{link.url}</p>
                    <p className="mt-1.5 text-[11px] text-ink-500">
                      {expiresLabel ? `${t("webchatLink.expiresAt")}: ${expiresLabel}` : t("webchatLink.expiresUnknown")}
                      {reused ? ` · ${t("webchatLink.reusedNote")}` : ""}
                    </p>
                  </div>
                  {sentOk ? (
                    <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      <Check className="h-3.5 w-3.5" />
                      {t("webchatLink.sentOk")}
                    </p>
                  ) : null}
                </>
              ) : !loading && !error ? (
                <p className="rounded-xl border border-ink-200 px-3 py-4 text-center text-xs text-ink-500 dark:border-ink-700">
                  {t("webchatLink.emptyLink")}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void generate(true)}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                  title={t("webchatLink.regenerate")}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t("webchatLink.regenerate")}
                </button>
                <button
                  type="button"
                  onClick={() => void revoke()}
                  disabled={loading || !link}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
                  title={t("webchatLink.revoke")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("webchatLink.revoke")}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copy()}
                  disabled={!link}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("webchatLink.copied") : t("webchatLink.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => void sendToCustomer()}
                  disabled={!link || sending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {t("webchatLink.send")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
