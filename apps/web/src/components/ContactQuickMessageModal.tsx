import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { Bold, Italic, Code, Link as LinkIcon, Strikethrough, List, ListOrdered, Smile } from "lucide-react";
import clsx from "clsx";

type InboxOption = { id: string; name: string; channelType: string; isDefault?: boolean };

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

const EMOJI_PICK = ["👋", "😊", "🙏", "✅", "📌", "💼", "🎯", "📞", "⭐", "🚀", "💬", "📎"];

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
    void loadInboxes();
  }, [open, loadInboxes, contact?.id]);

  const selectedInbox = inboxes.find((i) => i.id === inboxId);

  const toolbarBtn =
    "rounded-md p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40";

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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="divide-y divide-zinc-800">
              <div className="flex items-baseline gap-3 px-4 py-3">
                <span className="shrink-0 text-sm font-medium text-zinc-500">{t("quickMessage.to")}</span>
                <span className="min-w-0 truncate text-sm text-zinc-100">
                  {contact.name}{" "}
                  <span className="text-zinc-500">· {contact.phone}</span>
                </span>
              </div>

              <div className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-500">{t("quickMessage.via")}</span>
                  <button
                    type="button"
                    onClick={() => setShowInboxList((v) => !v)}
                    className="text-sm font-medium text-sky-400 hover:text-sky-300"
                  >
                    {showInboxList ? t("quickMessage.hideInboxes") : t("quickMessage.showInboxes")}
                  </button>
                  {selectedInbox ? (
                    <span className="text-xs text-zinc-500">
                      {selectedInbox.name} ({selectedInbox.channelType})
                    </span>
                  ) : null}
                </div>
                {showInboxList ? (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
                    {inboxes.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-zinc-500">{t("quickMessage.noInboxes")}</p>
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
                            "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-800",
                            ib.id === inboxId && "bg-zinc-800/80 text-sky-300",
                          )}
                        >
                          <span className="text-zinc-200">{ib.name}</span>
                          <span className="text-xs text-zinc-500">{ib.channelType}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className="px-2 pt-2">
                <div className="flex flex-wrap gap-0.5 border-b border-zinc-800/80 px-2 pb-2">
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
                </div>
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
                  className="w-full resize-none bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                />
              </div>

              {error ? (
                <div className="px-4 py-2 text-xs text-red-400">{error}</div>
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
                  {showEmoji ? (
                    <div className="absolute bottom-full left-0 z-10 mb-1 flex max-w-[220px] flex-wrap gap-1 rounded-lg border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
                      {EMOJI_PICK.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className="rounded p-1.5 text-lg hover:bg-zinc-800"
                          onClick={() => {
                            const el = taRef.current;
                            if (el) {
                              const start = el.selectionStart;
                              const val = el.value;
                              const next = val.slice(0, start) + em + val.slice(start);
                              el.value = next;
                              el.focus();
                              el.setSelectionRange(start + em.length, start + em.length);
                              setBody(next);
                            }
                            setShowEmoji(false);
                          }}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    {t("quickMessage.discard")}
                  </button>
                  <button
                    type="button"
                    disabled={sending || !body.trim()}
                    onClick={() => void onSend()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 hover:bg-sky-400 disabled:opacity-50"
                  >
                    {sending ? t("quickMessage.sending") : t("quickMessage.send")}
                    <span className="text-sky-100/90">{t("quickMessage.sendShortcut")}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
