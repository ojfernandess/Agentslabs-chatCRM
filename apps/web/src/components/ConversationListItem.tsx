import { NavLink } from "react-router-dom";
import { Bot, UserCircle } from "lucide-react";
import clsx from "clsx";
import { format, isToday, isYesterday } from "date-fns";
import type { Locale } from "date-fns";
import { useI18n } from "@/i18n/I18nProvider";
import { ConversationListAvatar } from "@/components/ConversationListAvatar";
import { ConversationPriorityBadge } from "@/components/ConversationPriorityBadge";
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

const statusColors: Record<string, string> = {
  OPEN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/55 dark:text-emerald-200",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-200",
  RESOLVED: "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300",
};

function formatListTimestamp(iso: string, dateLocale: Locale): string {
  const date = new Date(iso);
  if (isToday(date)) return format(date, "HH:mm", { locale: dateLocale });
  if (isYesterday(date)) return format(date, "dd/MM", { locale: dateLocale });
  return format(date, "dd/MM", { locale: dateLocale });
}

function channelBadgeLabel(
  inbox: ConversationListRow["inbox"],
  t: (key: string) => string,
): string | null {
  if (!inbox) return null;
  if (inbox.channelType === "WHATSAPP") return t("conversationDetail.channelLabelWhatsapp");
  if (inbox.channelType === "EMAIL") return "E-mail";
  const name = inbox.name.trim();
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

type Props = {
  conv: ConversationListRow;
  isSelected: boolean;
  linkTo: string;
  statusLabel: (status: string) => string;
  fmtMoney: (n: number) => string;
  showContactTags: boolean;
  currentUserId?: string;
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
  onPrefetch,
  onContextMenu,
}: Props) {
  const { t, dateLocale } = useI18n();
  const lastMessage = conv.messages?.[0];
  const preview =
    formatMessageBodyForPreview(lastMessage?.body, {
      messageType: lastMessage?.type,
    }) || t("conversations.noMessages");
  const channelLabel = channelBadgeLabel(conv.inbox, t);
  const displayTags = showContactTags ? filterTagsForDisplay(conv.contact.tags ?? []) : [];
  const hasHumanAssignee =
    typeof conv.assignedTo?.id === "string" && conv.assignedTo.id.length > 0;
  const showBotBadge =
    conv.agentBotTriageActive &&
    !conv.awaitingHumanHandoff &&
    (conv.status === "OPEN" || conv.status === "PENDING");
  const showAwaitingHuman =
    conv.awaitingHumanHandoff && !hasHumanAssignee;

  return (
    <div onContextMenu={onContextMenu} className="group">
      <div className="flex items-stretch">
        <NavLink
          to={linkTo}
          preventScrollReset
          onMouseDown={onPrefetch}
          onMouseEnter={onPrefetch}
          onFocus={onPrefetch}
          className={({ isActive }) =>
            clsx(
              "flex min-w-0 flex-1 gap-2.5 border-b border-ink-100 px-3 py-2.5 transition dark:border-ink-800",
              priorityListCardClass(conv.priority),
              conv.isUnread && "bg-brand-50/40 dark:bg-brand-950/20",
              isActive || isSelected
                ? "border-l-[3px] border-l-brand-500 bg-brand-50/70 dark:bg-brand-950/35"
                : "border-l-[3px] border-l-transparent hover:bg-ink-50/80 dark:hover:bg-ink-900/40",
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
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1">
                  {conv.isUnread ? (
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                      title={t("conversations.unreadBadge")}
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={clsx(
                      "break-words text-sm leading-snug text-ink-900 dark:text-ink-50",
                      conv.isUnread ? "font-bold" : "font-semibold",
                    )}
                  >
                    {conv.contact.name}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <span
                    className={clsx(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                      statusColors[conv.status] ?? statusColors.OPEN,
                    )}
                  >
                    {statusLabel(conv.status)}
                  </span>
                  {channelLabel ? (
                    <span
                      className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-950/35 dark:text-violet-200"
                      title={conv.inbox?.name}
                    >
                      {channelLabel}
                    </span>
                  ) : null}
                  {showBotBadge ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950/35 dark:text-violet-200"
                      title={t("conversationDetail.botTriageBanner")}
                    >
                      <Bot className="h-3 w-3" aria-hidden />
                      {hasHumanAssignee
                        ? t("conversationDetail.transferToBot")
                        : t("conversationDetail.botInAttendance")}
                    </span>
                  ) : null}
                </div>
              </div>
              <span
                className="shrink-0 text-[10px] font-medium tabular-nums text-ink-500 dark:text-ink-400"
                title={format(new Date(conv.updatedAt), "PPp", { locale: dateLocale })}
              >
                {formatListTimestamp(conv.updatedAt, dateLocale)}
              </span>
            </div>

            <p
              className={clsx(
                "mt-0.5 line-clamp-1 text-xs leading-snug",
                conv.isUnread
                  ? "font-medium text-ink-700 dark:text-ink-200"
                  : "text-ink-500 dark:text-ink-400",
              )}
              title={preview}
            >
              {preview}
            </p>

            <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[10px] text-ink-500 dark:text-ink-400">
              {hasHumanAssignee &&
              (conv.status === "OPEN" || conv.status === "PENDING") ? (
                <span
                  className="shrink-0 truncate rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100"
                  title={`${conv.assignedTo!.name} · ${t("conversations.inAttendance")}`}
                >
                  {t("conversations.inAttendance")}
                </span>
              ) : null}
              {hasHumanAssignee ? (
                <span
                  className="inline-flex min-w-0 max-w-[45%] items-center gap-1 truncate"
                  title={
                    conv.status === "OPEN" || conv.status === "PENDING"
                      ? `${conv.assignedTo!.name} · ${t("conversations.inAttendance")}`
                      : `${t("conversations.listAssignee")}: ${conv.assignedTo!.name}`
                  }
                >
                  <UserCircle className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="truncate">{conv.assignedTo!.name}</span>
                </span>
              ) : null}
              {isConversationPriority(conv.priority) ? (
                <ConversationPriorityBadge priority={conv.priority} variant="compact" />
              ) : null}
              {conv.status === "RESOLVED" && conv.leadType ? (
                <span
                  className="shrink-0 truncate rounded px-1.5 py-0.5 font-semibold text-white"
                  style={{ backgroundColor: conv.leadType.color }}
                  title={conv.leadType.name}
                >
                  {conv.leadType.name}
                </span>
              ) : null}
              {conv.status === "RESOLVED" && conv.closureValue != null && conv.closureValue > 0 ? (
                <span
                  className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-300"
                  title={fmtMoney(conv.closureValue)}
                >
                  {fmtMoney(conv.closureValue)}
                </span>
              ) : null}
              {displayTags.slice(0, 2).map(({ tag }) => (
                <span
                  key={tag.id}
                  className="shrink-0 truncate rounded px-1.5 py-0.5 font-semibold text-white"
                  style={{ backgroundColor: tag.color }}
                  title={tag.name}
                >
                  {tag.name}
                </span>
              ))}
              {displayTags.length > 2 ? (
                <span className="shrink-0 text-ink-400">+{displayTags.length - 2}</span>
              ) : null}
              {showAwaitingHuman ? (
                <span
                  className="shrink-0 truncate rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800 dark:bg-red-950/45 dark:text-red-100"
                  title={t("conversationDetail.awaitingHumanBanner")}
                >
                  {t("conversationDetail.awaitingHumanBadge")}
                </span>
              ) : null}
              <ConversationVoiceCallListBadge
                activeVoiceCall={conv.activeVoiceCall}
                className="!max-w-[8rem] !px-1.5 !py-0 !text-[10px]"
              />
            </div>
          </div>
        </NavLink>

        <div className="flex shrink-0 items-center border-b border-ink-100 pr-2 dark:border-ink-800">
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
