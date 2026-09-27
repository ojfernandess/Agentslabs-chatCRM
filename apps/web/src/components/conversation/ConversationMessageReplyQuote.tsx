import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import type { ConversationMessageReply } from "@/lib/conversationMessageReply";

type Props = {
  reply: ConversationMessageReply;
  inbound: boolean;
  onJumpToOriginal?: (messageId: string) => void;
};

export function ConversationMessageReplyQuote({ reply, inbound, onJumpToOriginal }: Props) {
  const { t } = useI18n();
  const unavailable = !reply.available || !reply.id;
  const clickable = !unavailable && Boolean(onJumpToOriginal);

  const content = unavailable
    ? t("conversationDetail.replyOriginalUnavailable")
    : reply.preview;

  const label = unavailable ? null : reply.senderLabel;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => {
        if (clickable && reply.id) onJumpToOriginal?.(reply.id);
      }}
      className={clsx(
        "mb-2 w-full rounded-lg border-l-[3px] px-2.5 py-1.5 text-left transition",
        inbound
          ? "border-brand-400/80 bg-black/5 dark:bg-white/5"
          : "border-white/70 bg-black/10 dark:border-white/40",
        clickable && "cursor-pointer hover:opacity-90",
        !clickable && "cursor-default",
      )}
    >
      {label ? (
        <p className="text-[11px] font-semibold opacity-80">{label}</p>
      ) : null}
      <p className="line-clamp-2 text-xs opacity-75">{content}</p>
    </button>
  );
}
