import clsx from "clsx";
import { ContactAvatar } from "@/components/ContactAvatar";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { ConversationPriorityBadge } from "@/components/ConversationPriorityBadge";
import { isConversationPriority, type ConversationPriority } from "@/lib/conversationPriority";

type Props = {
  contactId: string;
  contactName: string;
  profilePictureUrl?: string | null;
  hasAvatar?: boolean;
  thumbnail?: string | null;
  channelType?: string;
  priority?: ConversationPriority | null;
  /** list = cartões da lista; detail = cabeçalho da conversa; message = balão no chat. */
  size?: "list" | "detail" | "message";
  /** Indicador de presença (cabeçalho do detalhe). */
  presenceOnline?: boolean;
  className?: string;
};

/** Avatar com foto circular, badge WhatsApp e prioridade. */
export function ConversationListAvatar({
  contactId,
  contactName,
  profilePictureUrl,
  hasAvatar,
  thumbnail,
  channelType,
  priority,
  size = "list",
  presenceOnline,
  className,
}: Props) {
  const isWhatsApp = channelType === "WHATSAPP";
  const showPriority = size !== "message" && isConversationPriority(priority);
  const avatarVariant = size === "detail" ? "detail" : size === "message" ? "message" : "list";

  return (
    <div className={clsx("relative shrink-0", className)}>
      <ContactAvatar
        contactId={contactId}
        name={contactName}
        profilePictureUrl={profilePictureUrl}
        hasAvatar={hasAvatar}
        thumbnail={thumbnail}
        variant={avatarVariant}
      />
      {presenceOnline !== undefined ? (
        <span
          className={clsx(
            "absolute bottom-0.5 right-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-ink-900",
            presenceOnline ? "bg-emerald-500" : "bg-ink-400 dark:bg-ink-600",
          )}
          aria-hidden
        />
      ) : null}
      {isWhatsApp ? (
        <span
          className={clsx(
            "absolute flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white shadow-md ring-2 ring-white dark:bg-ink-900 dark:ring-ink-950",
            size === "detail" ? "-left-0.5 -top-0.5" : "-bottom-0.5 -right-0.5",
          )}
          title="WhatsApp"
        >
          <WhatsAppBrandIcon className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {showPriority ? (
        <span className="absolute -left-0.5 -top-0.5 z-[1]">
          <ConversationPriorityBadge priority={priority!} variant="compact" />
        </span>
      ) : null}
    </div>
  );
}
