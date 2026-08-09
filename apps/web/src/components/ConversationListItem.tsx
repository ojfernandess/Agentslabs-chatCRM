import { NavLink } from "react-router-dom";
import { Bot, Headset, UserCircle } from "lucide-react";
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
  OPEN: "badge-status-open",
  PENDING: "badge-status-pending",
  RESOLVED: "badge-status-resolved",
};

const awaitingHumanBadgeClass = "badge-alert";

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
              "flex min-w-0 flex-1 gap-2.5 border-b inbox-hairline-soft px-3 py-2.5 transition",
              priorityListCardClass(conv.priority),
              conv.isUnread && "bg-brand-50/40 dark:bg-brand-950/20",
              isActive || isSelected
                ? "border-l-2 border-l-brand-500 bg-brand-50/60 dark:bg-brand-950/35"
                : "border-l-2 border-l-transparent hover:bg-ink-50/80 dark:hover:bg-ink-900/40",
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
                      "badge-status",
                      statusColors[conv.status] ?? statusColors.OPEN,
                    )}
                  >
                    {statusLabel(conv.status)}
                  </span>
                  {channelLabel ? (
                    <span className="badge-meta" title={conv.inbox?.name}>
                      {channelLabel}
                    </span>
                  ) : null}
                  {showBotBadge ? (
                    <span
                      className="badge-meta"
                      title={t("conversationDetail.botTriageBanner")}
                    >
                      <Bot className="h-2.5 w-2.5" aria-hidden />
                      {hasHumanAssignee
                        ? t("conversationDetail.transferToBot")
                        : t("conversationDetail.botInAttendance")}
                    </span>
                  ) : null}
                  {showAwaitingHuman ? (
                    <span
                      className={awaitingHumanBadgeClass}
                      title={t("conversationDetail.awaitingHumanBanner")}
                    >
                      <Headset className="h-2.5 w-2.5" aria-hidden />
                      {t("conversationDetail.awaitingHumanBadge")}
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

            <div
              className={clsx(
                "mt-1 flex min-w-0 gap-2 text-[10px] text-ink-500 dark:text-ink-400",
                splitView ? "flex-wrap items-center" : "items-center overflow-hidden",
              )}
            >
              {hasHumanAssignee &&
              (conv.status === "OPEN" || conv.status === "PENDING") ? (
                splitView ? (
                  <span
                    className="badge-status badge-status-open max-w-full flex-wrap gap-1"
                    title={`${conv.assignedTo!.name} · ${t("conversations.inAttendance")}`}
                  >
                    <UserCircle className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="break-words font-semibold leading-snug">
                      {conv.assignedTo!.name}
                    </span>
                  </span>
                ) : (
                  <span
                    className="badge-status badge-status-open"
                    title={`${conv.assignedTo!.name} · ${t("conversations.inAttendance")}`}
                  >
                    {t("conversations.inAttendance")}
                  </span>
                )
              ) : null}
              {hasHumanAssignee && !splitView ? (
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
              ) : hasHumanAssignee &&
                splitView &&
                conv.status !== "OPEN" &&
                conv.status !== "PENDING" ? (
                <span
                  className="inline-flex max-w-full flex-wrap items-center gap-1"
                  title={`${t("conversations.listAssignee")}: ${conv.assignedTo!.name}`}
                >
                  <UserCircle className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="break-words text-[10px] font-medium leading-snug text-ink-600 dark:text-ink-300">
                    {conv.assignedTo!.name}
                  </span>
                </span>
              ) : null}
              {isConversationPriority(conv.priority) ? (
                <ConversationPriorityBadge priority={conv.priority} variant="compact" />
              ) : null}
              {conv.status === "RESOLVED" && conv.leadType ? (
                <span
                  className="badge-tag max-w-[7rem] truncate"
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
                  className="badge-tag max-w-[5.5rem] truncate"
                  style={{ backgroundColor: tag.color }}
                  title={tag.name}
                >
                  {tag.name}
                </span>
              ))}
              {displayTags.length > 2 ? (
                <span className="shrink-0 text-ink-400">+{displayTags.length - 2}</span>
              ) : null}
              <ConversationVoiceCallListBadge
                activeVoiceCall={conv.activeVoiceCall}
                className="!max-w-[8rem] !px-1.5 !py-0 !text-[10px]"
              />
            </div>
          </div>
        </NavLink>

        <div className="flex shrink-0 items-center border-b inbox-hairline-soft pr-2">
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
