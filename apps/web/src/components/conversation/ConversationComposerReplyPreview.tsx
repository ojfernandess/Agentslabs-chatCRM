import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { ConversationMessageReply } from "@/lib/conversationMessageReply";

type Props = {
  reply: ConversationMessageReply;
  onCancel: () => void;
};

export function ConversationComposerReplyPreview({ reply, onCancel }: Props) {
  const { t } = useI18n();
  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-brand-300/50 bg-brand-50/80 px-3 py-2 dark:border-brand-500/30 dark:bg-brand-950/30">
      <div className="min-w-0 flex-1 border-l-2 border-brand-500 pl-2.5">
        <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">
          {t("conversationDetail.replyingTo").replace("{name}", reply.senderLabel)}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-600 dark:text-ink-300">{reply.preview}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-md p-1 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100"
        title={t("conversationDetail.cancelReply")}
        aria-label={t("conversationDetail.cancelReply")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
