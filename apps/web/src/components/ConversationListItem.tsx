import { NavLink } from "react-router-dom";
import { Bot, Headset } from "lucide-react";
import clsx from "clsx";
import { format, isToday, isYesterday } from "date-fns";
import type { Locale } from "date-fns";
import { useI18n } from "@/i18n/I18nProvider";
import { ConversationListAvatar } from "@/components/ConversationListAvatar";
import { ConversationVoiceCallListBadge } from "@/components/ConversationVoiceCallListBadge";
import { TelephonyCallButton } from "@/components/telephony/TelephonyCallButton";
import type { ActiveVoiceCall } from "@/lib/activeVoiceCall";
import { filterTagsForDisplay } from "@/lib/tagDisplay";
import { formatMessageBodyForPreview } from "@/lib/messagePreviewText";
import { isConversationPriority, priorityListCardClass, type ConversationPriority } from "@/lib/conversationPriority";

export type ConversationListRow = {
  id: string;
  status: string;
  priority?: ConversationPriority | null;
  isUnread?: boolean;
  updatedAt: string;
  agentBotTriageActive?: boolean;
  awaitingHumanHandoff?: boolean;
  closureValue?: number | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    profilePictureUrl?: string | null;
    hasAvatar?: boolean;
    thumbnail?: string | null;
    tags?: { tag: { id: string; name: string; color: string } }[];
  };
  assignedTo: { id: string; name: string } | null;
  inbox?: { id: string; name: string; isDefault: boolean; channelType?: string } | null;
  leadType: { id: string; name: string; color: string } | null;
  messages: { body: string | null; direction: string; createdAt: string; type?: string }[];
  activeVoiceCall?: ActiveVoiceCall | null;
};

const statusDotClass: Record<string, string> = {
  OPEN: "bg-emerald-500",
  PENDING: "bg-amber-500",
  RESOLVED: "bg-ink-300 dark:bg-ink-600",
};

function formatListTimestamp(iso: string, dateLocale: Locale): string {
  const date = new Date(iso);
  if (isToday(date)) return format(date, "HH:mm", { locale: dateLocale });
  if (isYesterday(date)) return format(date, "dd/MM", { locale: dateLocale });
  return format(date, "dd/MM HH:mm", { locale: dateLocale });
}

type Props = {
  conv: ConversationListRow;
  isSelected: boolean;
  linkTo: string;
  statusLabel: (status: string) => string;
  fmtMoney: (n: number) => string;
  showContactTags: boolean;
  currentUserId?: string;
  splitView?: boolean;
  onPrefetch: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

export function ConversationListItem({
  conv,
  isSelected,
  linkTo,
  statusLabel,
  fmtMoney,
  showContactTags,
  currentUserId,
  splitView = false,
  onPrefetch,
  onContextMenu,
}: Props) {
  const { t, dateLocale } = useI18n();
  const lastMessage = conv.messages?.[0];
  const preview =
    formatMessageBodyForPreview(lastMessage?.body, {
      messageType: lastMessage?.type,
    }) || t("conversations.noMessages");
  const displayTags = showContactTags ? filterTagsForDisplay(conv.contact.tags ?? []) : [];
  const hasHumanAssignee =
    typeof conv.assignedTo?.id === "string" && conv.assignedTo.id.length > 0;
  const showBotBadge =
    conv.agentBotTriageActive &&
    !conv.awaitingHumanHandoff &&
    (conv.status === "OPEN" || conv.status === "PENDING");
  const showAwaitingHuman = conv.awaitingHumanHandoff && !hasHumanAssignee;
  const primaryTag = displayTags[0]?.tag ?? (conv.status === "RESOLVED" && conv.leadType ? conv.leadType : null);

  return (
    <div onContextMenu={onContextMenu} className="group px-2 py-0.5">
      <div className="flex items-stretch gap-0.5">
        <NavLink
          to={linkTo}
          preventScrollReset
          onMouseDown={onPrefetch}
          onMouseEnter={onPrefetch}
          onFocus={onPrefetch}
          className={({ isActive }) =>
            clsx(
              "flex min-w-0 flex-1 gap-2.5 rounded-xl border px-2.5 py-2.5 transition-all",
              priorityListCardClass(conv.priority),
              isActive || isSelected
                ? "border-brand-300/60 bg-white shadow-sm ring-1 ring-brand-500/15 dark:border-brand-700/40 dark:bg-ink-900/60 dark:ring-brand-500/20"
                : conv.isUnread
                  ? "border-brand-200/40 bg-white shadow-sm dark:border-brand-800/30 dark:bg-ink-900/40"
                  : "border-transparent bg-transparent hover:border-ink-200/60 hover:bg-white/90 hover:shadow-sm dark:hover:border-ink-700/50 dark:hover:bg-ink-900/35",
            )
          }
        >
          <ConversationListAvatar
            compact
            contactId={conv.contact.id}
            contactName={conv.contact.name}
            profilePictureUrl={conv.contact.profilePictureUrl}
            hasAvatar={conv.contact.hasAvatar}
            thumbnail={conv.contact.thumbnail}
            channelType={conv.inbox?.channelType}
            priority={conv.priority}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={clsx(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    statusDotClass[conv.status] ?? statusDotClass.OPEN,
                  )}
                  title={statusLabel(conv.status)}
                  aria-hidden
                />
                <span
                  className={clsx(
                    "truncate text-[13px] leading-tight text-ink-900 dark:text-ink-50",
                    conv.isUnread ? "font-semibold" : "font-medium",
                  )}
                >
                  {conv.contact.name}
                </span>
              </div>
              <span
                className="shrink-0 text-[10px] tabular-nums text-ink-400 dark:text-ink-500"
                title={format(new Date(conv.updatedAt), "PPp", { locale: dateLocale })}
              >
                {formatListTimestamp(conv.updatedAt, dateLocale)}
              </span>
            </div>

            <p
              className={clsx(
                "mt-0.5 line-clamp-1 text-[12px] leading-snug",
                conv.isUnread
                  ? "font-medium text-ink-700 dark:text-ink-200"
                  : "text-ink-500 dark:text-ink-400",
              )}
              title={preview}
            >
              {preview}
            </p>

            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span className="shrink-0 text-[10px] font-medium text-ink-500 dark:text-ink-400">
                {statusLabel(conv.status)}
              </span>
              {primaryTag ? (
                <span
                  className="max-w-[5.5rem] shrink-0 truncate rounded-md px-1.5 py-px text-[10px] font-medium text-white/95"
                  style={{ backgroundColor: primaryTag.color }}
                  title={primaryTag.name}
                >
                  {primaryTag.name}
                </span>
              ) : null}
              {showBotBadge ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300"
                  title={t("conversationDetail.botInAttendance")}
                >
                  <Bot className="h-3 w-3" aria-hidden />
                  IA
                </span>
              ) : null}
              {showAwaitingHuman ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400"
                  title={t("conversationDetail.awaitingHumanBanner")}
                >
                  <Headset className="h-3 w-3" aria-hidden />
                </span>
              ) : null}
              {hasHumanAssignee && (conv.status === "OPEN" || conv.status === "PENDING") ? (
                <span
                  className="min-w-0 truncate text-[10px] text-ink-400 dark:text-ink-500"
                  title={conv.assignedTo!.name}
                >
                  · {conv.assignedTo!.name}
                </span>
              ) : null}
              {conv.status === "RESOLVED" && conv.closureValue != null && conv.closureValue > 0 ? (
                <span className="shrink-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  {fmtMoney(conv.closureValue)}
                </span>
              ) : null}
              <ConversationVoiceCallListBadge
                activeVoiceCall={conv.activeVoiceCall}
                className="!max-w-[6rem] !px-1 !py-0 !text-[10px]"
              />
            </div>
          </div>

          {conv.isUnread ? (
            <span
              className="mt-1 flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white"
              title={t("conversations.unreadBadge")}
            >
              •
            </span>
          ) : null}
        </NavLink>

        <div className="flex shrink-0 items-center">
          <TelephonyCallButton
            phone={conv.contact.phone}
            inboxId={conv.inbox?.id}
            conversationId={conv.id}
            contactId={conv.contact.id}
            activeVoiceCall={conv.activeVoiceCall}
            iconOnly
            stopPropagation
            peerOnCall={(() => {
              const call = conv.activeVoiceCall;
              if (!call?.agent?.id || call.agent.id === currentUserId) return null;
              return { agentName: call.agent.name };
            })()}
          />
        </div>
      </div>
    </div>
  );
}
