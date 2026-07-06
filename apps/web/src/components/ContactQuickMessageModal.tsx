import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { Bold, Italic, Code, Link as LinkIcon, Strikethrough, List, ListOrdered, Smile, FileText } from "lucide-react";
import clsx from "clsx";
import { isWhatsAppCloudApiProvider } from "@/lib/inboxWhatsappConfig";
import { parseInboxWhatsappFromChannelConfig } from "@/lib/inboxWhatsappConfig";
import { TemplateSendModal, type TemplateSendModalTemplate } from "@/components/TemplateSendModal";
import { EmojiPickerPopover } from "@/components/EmojiPickerPopover";
import { insertTextAtSelection } from "@/lib/insertTextAtSelection";
import type { EmojiCategoryId } from "@/lib/emojiPickerData";

type InboxOption = {
  id: string;
  name: string;
  channelType: string;
  isDefault?: boolean;
  channelConfig?: unknown;
};

function wrapSelection(el: HTMLTextAreaElement, before: string, after: string) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const val = el.value;
  const sel = val.slice(start, end);
  const next = val.slice(0, start) + before + sel + after + val.slice(end);
  el.value = next;
  const innerStart = start + before.length;
  const innerEnd = innerStart + sel.length;
  el.focus();
  el.setSelectionRange(innerStart, innerEnd);
}

function insertLinePrefix(el: HTMLTextAreaElement, prefix: string) {
  const start = el.selectionStart;
  const val = el.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const next = val.slice(0, lineStart) + prefix + val.slice(lineStart);
  el.value = next;
  el.focus();
  el.setSelectionRange(start + prefix.length, start + prefix.length);
}

export function ContactQuickMessageModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: { id: string; name: string; phone: string } | null;
}) {
  const { t } = useI18n();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [inboxId, setInboxId] = useState<string>("");
  const [showInboxList, setShowInboxList] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<TemplateSendModalTemplate[]>([]);
  const [templateModal, setTemplateModal] = useState<TemplateSendModalTemplate | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const loadInboxes = useCallback(async () => {
    try {
      const res = await api.get<{ data: InboxOption[] }>("/inboxes");
      const rows = [...(res.data ?? [])].sort(
        (a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name),
      );
      setInboxes(rows);
      setInboxId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? "";
      });
    } catch {
      setInboxes([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setBody("");
    setError("");
    setShowEmoji(false);
    setShowInboxList(false);
    setTemplatePickerOpen(false);
    setTemplateModal(null);
    void loadInboxes();
    void (async () => {
      try {
        const rows = await api.get<TemplateSendModalTemplate[]>("/templates");
        setMessageTemplates(rows ?? []);
      } catch {
        setMessageTemplates([]);
      }
    })();
  }, [open, loadInboxes, contact?.id]);

  const selectedInbox = inboxes.find((i) => i.id === inboxId);
  const selectedWaProvider = selectedInbox
    ? parseInboxWhatsappFromChannelConfig(selectedInbox.channelConfig).whatsappProvider
    : null;
  const isMetaInbox =
    selectedInbox?.channelType === "WHATSAPP" && isWhatsAppCloudApiProvider(selectedWaProvider ?? "");

  const toolbarBtn =
    "rounded-md p-2 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:text-ink-400 dark:hover:bg-ink-800";

  const onSend = async () => {
    if (!contact) return;
    const text = body.trim();
    if (!text) return;
    if (!inboxId) {
      setError(t("quickMessage.inboxRequired"));
      setShowInboxList(true);
      return;
    }
    setSending(true);
    setError("");
    try {
      await api.post("/messages", {
        contactId: contact.id,
        inboxId,
        type: "TEXT",
        body: text,
      });
      setBody("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("quickMessage.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const applyFormat = (fn: (el: HTMLTextAreaElement) => void) => {
    const el = taRef.current;
    if (!el) return;
    fn(el);
    setBody(el.value);
  };

  if (!contact) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 dark:bg-black/60"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="divide-y divide-gray-100 dark:divide-ink-800">
              <div className="flex items-baseline gap-3 px-4 py-3">
                <span className="shrink-0 text-sm font-medium text-gray-500 dark:text-ink-400">
                  {t("quickMessage.to")}
                </span>
                <span className="min-w-0 truncate text-sm text-gray-900 dark:text-ink-100">
                  {contact.name}{" "}
                  <span className="text-gray-500 dark:text-ink-400">· {contact.phone}</span>
                </span>
              </div>

              <div className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-500 dark:text-ink-400">{t("quickMessage.via")}</span>
                  <button
                    type="button"
                    onClick={() => setShowInboxList((v) => !v)}
                    className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    {showInboxList ? t("quickMessage.hideInboxes") : t("quickMessage.showInboxes")}
                  </button>
                  {selectedInbox ? (
                    <span className="text-xs text-gray-500 dark:text-ink-400">
                      {selectedInbox.name} ({selectedInbox.channelType})
                    </span>
                  ) : null}
                </div>
                {showInboxList ? (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/80 dark:border-ink-700 dark:bg-ink-950/80">
                    {inboxes.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-gray-500 dark:text-ink-400">{t("quickMessage.noInboxes")}</p>
                    ) : (
                      inboxes.map((ib) => (
                        <button
                          key={ib.id}
                          type="button"
                          onClick={() => {
                            setInboxId(ib.id);
                            setShowInboxList(false);
                          }}
                          className={clsx(
                            "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white dark:hover:bg-ink-800",
                            ib.id === inboxId && "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950/40 dark:text-brand-200",
                          )}
                        >
                          <span className="text-gray-900 dark:text-ink-100">{ib.name}</span>
                          <span className="text-xs text-gray-500 dark:text-ink-400">{ib.channelType}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className="px-2 pt-2">
                {isMetaInbox ? (
                  <p className="mb-2 px-2 text-xs text-amber-800/90 dark:text-amber-200/90">
                    {t("quickMessage.metaTemplatesOnly")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-0.5 border-b border-gray-100 px-2 pb-2 dark:border-ink-800">
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.bold")}
                    onClick={() => applyFormat((el) => wrapSelection(el, "*", "*"))}
                  >
                    <Bold className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.italic")}
                    onClick={() => applyFormat((el) => wrapSelection(el, "_", "_"))}
                  >
                    <Italic className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.code")}
                    onClick={() => applyFormat((el) => wrapSelection(el, "```", "```"))}
                  >
                    <Code className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.link")}
                    onClick={() => {
                      const url = window.prompt(t("quickMessage.linkPrompt"));
                      if (!url?.trim()) return;
                      applyFormat((el) => wrapSelection(el, url.trim() + " ", ""));
                    }}
                  >
                    <LinkIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.strike")}
                    onClick={() => applyFormat((el) => wrapSelection(el, "~", "~"))}
                  >
                    <Strikethrough className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.bullet")}
                    onClick={() => applyFormat((el) => insertLinePrefix(el, "• "))}
                  >
                    <List className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.numbered")}
                    onClick={() => applyFormat((el) => insertLinePrefix(el, "1. "))}
                  >
                    <ListOrdered className="h-4 w-4" />
                  </button>
                  {isMetaInbox && messageTemplates.length > 0 ? (
                    <button
                      type="button"
                      className={toolbarBtn}
                      title={t("quickMessage.templates")}
                      onClick={() => setTemplatePickerOpen((v) => !v)}
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                {templatePickerOpen && isMetaInbox ? (
                  <div className="mx-2 mb-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 dark:border-ink-700 dark:bg-ink-900">
                    {messageTemplates.map((tp) => (
                      <button
                        key={tp.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-ink-800"
                        onClick={() => {
                          setTemplatePickerOpen(false);
                          setTemplateModal(tp);
                        }}
                      >
                        <span className="font-semibold text-gray-900 dark:text-ink-100">{tp.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <textarea
                  ref={taRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                  rows={6}
                  placeholder={t("quickMessage.placeholder")}
                  className="w-full resize-none bg-transparent px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-ink-100 dark:placeholder:text-ink-500"
                />
              </div>

              {error ? (
                <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>
              ) : null}

              <div className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="relative">
                  <button
                    type="button"
                    className={toolbarBtn}
                    title={t("quickMessage.emoji")}
                    onClick={() => setShowEmoji((v) => !v)}
                  >
                    <Smile className="h-4 w-4" />
                  </button>
                  <EmojiPickerPopover
                    open={showEmoji}
                    onSelect={(em) => {
                      insertTextAtSelection(taRef.current, body, em, setBody);
                      setShowEmoji(false);
                    }}
                    categoryLabel={(id: EmojiCategoryId) => t(`common.emojiCategory.${id}`)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-800"
                  >
                    {t("quickMessage.discard")}
                  </button>
                  <button
                    type="button"
                    disabled={sending || !body.trim()}
                    onClick={() => void onSend()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
                  >
                    {sending ? t("quickMessage.sending") : t("quickMessage.send")}
                    <span className="font-normal text-white/90">{t("quickMessage.sendShortcut")}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      <TemplateSendModal
        open={templateModal !== null}
        template={templateModal}
        contactId={contact.id}
        inboxId={inboxId || undefined}
        onClose={() => setTemplateModal(null)}
        onSent={() => {
          setTemplateModal(null);
          onClose();
        }}
      />
    </AnimatePresence>
  );
}
