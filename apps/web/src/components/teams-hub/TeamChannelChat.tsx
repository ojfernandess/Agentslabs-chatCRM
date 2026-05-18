import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import type { Locale } from "date-fns";
import { ImagePlus, Paperclip, Send, Smile, SmilePlus } from "lucide-react";
import { api } from "@/lib/api";
import { EMOJI_CATEGORIES, REACTION_QUICK_EMOJIS, type EmojiCategoryId } from "./emojiPickerData";

export type ChannelMessageReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: { id: string; name: string }[];
};

export type ChannelMessage = {
  id: string;
  body: string;
  messageType: "TEXT" | "IMAGE" | "DOCUMENT" | "FILE";
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  createdAt: string;
  author: { id: string; name: string };
  reactions: ChannelMessageReaction[];
};

interface Props {
  teamId: string;
  channelId: string | null;
  currentUserId?: string;
  dateLocale: Locale;
  t: (path: string) => string;
  onActivity?: () => void;
}

function inferMessageType(mimeType: string): ChannelMessage["messageType"] {
  const m = mimeType.split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "IMAGE";
  if (
    m === "application/pdf" ||
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "DOCUMENT";
  }
  return "FILE";
}

export function TeamChannelChat({ teamId, channelId, currentUserId, dateLocale, t, onActivity }: Props) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState<EmojiCategoryId>("smileys");
  const [reactionForId, setReactionForId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    if (!channelId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<{ data: ChannelMessage[] }>(
        `/teams/${teamId}/channels/${channelId}/messages`,
      );
      setMessages(res.data);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, channelId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!emojiOpen && !reactionForId) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (emojiOpen && emojiWrapRef.current && !emojiWrapRef.current.contains(node)) setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [emojiOpen, reactionForId]);

  const sendMessage = async (payload: {
    body?: string;
    messageType?: ChannelMessage["messageType"];
    attachmentUrl?: string;
    attachmentName?: string;
    attachmentMimeType?: string;
  }) => {
    if (!channelId) return;
    setSending(true);
    try {
      await api.post(`/teams/${teamId}/channels/${channelId}/messages`, payload);
      setDraft("");
      await loadMessages();
      onActivity?.();
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending || attachBusy) return;
    await sendMessage({ body });
  };

  const uploadAndSend = async (file: File) => {
    if (!channelId || attachBusy) return;
    setAttachBusy(true);
    try {
      const { mediaUrl, mimeType } = await api.uploadMessageMedia(file, file.name);
      const messageType = inferMessageType(mimeType);
      const caption = draft.trim();
      await sendMessage({
        body: caption || file.name,
        messageType,
        attachmentUrl: mediaUrl,
        attachmentName: file.name,
        attachmentMimeType: mimeType,
      });
    } catch {
      window.alert(t("teamsHub.channelAttachFailed"));
    } finally {
      setAttachBusy(false);
    }
  };

  const onFilePicked = (file: File | undefined, imagesOnly: boolean) => {
    if (!file) return;
    const mime = file.type || "application/octet-stream";
    if (imagesOnly && !mime.startsWith("image/")) {
      window.alert(t("teamsHub.channelImageOnly"));
      return;
    }
    void uploadAndSend(file);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!channelId) return;
    try {
      await api.post(`/teams/${teamId}/channels/${channelId}/messages/${messageId}/reactions`, {
        emoji,
      });
      setReactionForId(null);
      await loadMessages();
    } catch {
      window.alert(t("teamsHub.channelReactionFailed"));
    }
  };

  const insertEmoji = (em: string) => {
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? draft.length;
      const end = el.selectionEnd ?? draft.length;
      const next = draft.slice(0, start) + em + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + em.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setDraft((prev) => prev + em);
    }
  };

  if (!channelId) {
    return (
      <p className="flex flex-1 items-center justify-center p-8 text-sm text-ink-500">
        {t("teamsHub.channelSelectHint")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-center text-sm text-ink-500">{t("teamsHub.channelLoading")}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-ink-500">{t("teamsHub.channelEmpty")}</p>
        ) : (
          messages.map((m) => {
            const isMine = currentUserId != null && m.author.id === currentUserId;
            return (
              <div
                key={m.id}
                className={clsx("group relative flex max-w-[88%] flex-col", isMine ? "ml-auto items-end" : "items-start")}
              >
                <div
                  className={clsx(
                    "rounded-2xl px-3 py-2",
                    isMine
                      ? "rounded-tr-md bg-brand-500/15 ring-1 ring-brand-500/25"
                      : "rounded-tl-md bg-ink-100 dark:bg-ink-900",
                  )}
                >
                  <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">{m.author.name}</p>
                  {m.attachmentUrl && m.messageType === "IMAGE" ? (
                    <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                      <img
                        src={m.attachmentUrl}
                        alt={m.attachmentName ?? t("teamsHub.channelAttachment")}
                        className="max-h-64 max-w-full rounded-lg object-contain"
                      />
                    </a>
                  ) : null}
                  {m.attachmentUrl && m.messageType !== "IMAGE" ? (
                    <a
                      href={m.attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white/80 px-2 py-1 text-xs font-medium text-brand-700 underline dark:bg-ink-950/60 dark:text-brand-300"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      {m.attachmentName ?? t("teamsHub.channelDownload")}
                    </a>
                  ) : null}
                  {m.body.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800 dark:text-ink-100">{m.body}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-ink-400">
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: dateLocale })}
                  </p>
                </div>

                {m.reactions.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        title={r.users.map((u) => u.name).join(", ")}
                        onClick={() => void toggleReaction(m.id, r.emoji)}
                        className={clsx(
                          "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition",
                          r.reactedByMe
                            ? "border-brand-400 bg-brand-500/15 font-semibold"
                            : "border-ink-200 bg-white/90 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900",
                        )}
                      >
                        <span>{r.emoji}</span>
                        <span className="tabular-nums text-ink-600 dark:text-ink-300">{r.count}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-0.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title={t("teamsHub.channelReact")}
                    onClick={() => setReactionForId((id) => (id === m.id ? null : m.id))}
                    className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
                  >
                    <SmilePlus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {reactionForId === m.id ? (
                  <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-xl border border-ink-200 bg-white p-1 shadow-lg dark:border-ink-700 dark:bg-ink-900">
                    {REACTION_QUICK_EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
                        onClick={() => void toggleReaction(m.id, em)}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-ink-100 p-3 dark:border-ink-800">
        <div className="flex items-end gap-2">
          <div className="flex shrink-0 items-center gap-0.5">
            <div className="relative" ref={emojiWrapRef}>
              <button
                type="button"
                title={t("teamsHub.channelEmoji")}
                disabled={attachBusy || sending}
                onClick={() => setEmojiOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
              >
                <Smile className="h-4 w-4" />
              </button>
              {emojiOpen ? (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-600 dark:bg-ink-900">
                  <div className="flex gap-0.5 overflow-x-auto border-b border-ink-100 p-1 dark:border-ink-800">
                    {EMOJI_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setEmojiCategory(cat.id)}
                        className={clsx(
                          "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold",
                          emojiCategory === cat.id
                            ? "bg-violet-500/15 text-violet-800 dark:text-violet-200"
                            : "text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800",
                        )}
                      >
                        {t(`teamsHub.emojiCategory.${cat.id}`)}
                      </button>
                    ))}
                  </div>
                  <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto p-2">
                    {(EMOJI_CATEGORIES.find((c) => c.id === emojiCategory) ?? EMOJI_CATEGORIES[0]).emojis.map(
                      (em) => (
                        <button
                          key={em}
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
                          onClick={() => insertEmoji(em)}
                        >
                          {em}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              title={t("teamsHub.channelAttachImage")}
              disabled={attachBusy || sending}
              onClick={() => imageInputRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t("teamsHub.channelAttachFile")}
              disabled={attachBusy || sending}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder={t("teamsHub.channelPlaceholder")}
            disabled={attachBusy || sending}
            className="input-field min-h-[40px] min-w-0 flex-1 resize-y py-2 text-sm"
          />

          <button
            type="button"
            disabled={sending || attachBusy || !draft.trim()}
            onClick={() => void handleSend()}
            className="btn-primary flex h-10 w-10 shrink-0 items-center justify-center p-0"
            title={t("teamsHub.channelSend")}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {attachBusy ? (
          <p className="mt-2 text-center text-xs text-ink-500">{t("teamsHub.channelSendingAttachment")}</p>
        ) : null}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFilePicked(e.target.files?.[0], true);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          onFilePicked(e.target.files?.[0], false);
          e.target.value = "";
        }}
      />
    </div>
  );
}
