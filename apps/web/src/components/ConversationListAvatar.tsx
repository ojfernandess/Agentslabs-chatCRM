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
  /** list = cartões da lista; listCompact = lista split-pane; detail = cabeçalho; message = balão. */
  size?: "list" | "listCompact" | "detail" | "message";
  /** Atalho para size="listCompact". */
  compact?: boolean;
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
  compact = false,
  presenceOnline,
  className,
}: Props) {
  const isWhatsApp = channelType === "WHATSAPP";
  const resolvedSize = compact ? "listCompact" : size;
  const showPriority = resolvedSize !== "message" && isConversationPriority(priority);
  const avatarVariant =
    resolvedSize === "detail"
      ? "detail"
      : resolvedSize === "message"
        ? "message"
        : resolvedSize === "listCompact"
          ? "listCompact"
          : "list";

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
            resolvedSize === "detail" ? "-left-0.5 -top-0.5" : "-bottom-0.5 -right-0.5",
            resolvedSize === "listCompact" && "h-[18px] w-[18px]",
          )}
          title="WhatsApp"
        >
          <WhatsAppBrandIcon className={clsx("h-3.5 w-3.5", resolvedSize === "listCompact" && "h-3 w-3")} />
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
