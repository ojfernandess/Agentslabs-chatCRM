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
  channelType?: string;
  priority?: ConversationPriority | null;
  className?: string;
};

/** Avatar da lista de conversas: foto circular, badge WhatsApp e prioridade. */
export function ConversationListAvatar({
  contactId,
  contactName,
  profilePictureUrl,
  hasAvatar,
  channelType,
  priority,
  className,
}: Props) {
  const isWhatsApp = channelType === "WHATSAPP";
  const showPriority = isConversationPriority(priority);

  return (
    <div className={clsx("relative shrink-0", className)}>
      <ContactAvatar
        contactId={contactId}
        name={contactName}
        profilePictureUrl={profilePictureUrl}
        hasAvatar={hasAvatar}
        variant="list"
      />
      {isWhatsApp ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white shadow-md ring-2 ring-white dark:bg-ink-900 dark:ring-ink-950"
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
