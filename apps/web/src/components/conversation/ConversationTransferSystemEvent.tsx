import clsx from "clsx";
import { format, isToday } from "date-fns";
import { useI18n } from "@/i18n/I18nProvider";
import type { TimelinePayload } from "@/lib/contactTimeline";
import { replaceTransferTokens, resolveTransferNotificationFromTimeline } from "@/lib/transferNotification";
import {
  TransferNotificationDescription,
  TransferNotificationIcon,
} from "@/components/workspace/TransferNotificationContent";

type ConversationTransferSystemEventProps = {
  occurredAt: string;
  payload: TimelinePayload;
  contactName: string;
  actorName?: string | null;
  showDateSeparator?: boolean;
};

function FlowChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-brand-200/80 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-ink-700 dark:border-brand-500/25 dark:bg-soft-surface-3/70 dark:text-soft-text-secondary">
      {children}
    </span>
  );
}

export function ConversationTransferSystemEvent({
  occurredAt,
  payload,
  contactName,
  actorName,
  showDateSeparator,
}: ConversationTransferSystemEventProps) {
  const { t, dateLocale } = useI18n();
  const at = new Date(occurredAt);
  const content = resolveTransferNotificationFromTimeline(payload, contactName, actorName ?? null);
  const dateLabel = isToday(at)
    ? `${t("conversationDetail.transferEventToday")}, ${format(at, "HH:mm", { locale: dateLocale })}`
    : format(at, "dd/MM/yyyy, HH:mm", { locale: dateLocale });

  const previousTeamName =
    typeof payload.previousTeamName === "string" && payload.previousTeamName.trim()
      ? payload.previousTeamName.trim()
      : null;
  const newTeamName =
    typeof payload.newTeamName === "string" && payload.newTeamName.trim()
      ? payload.newTeamName.trim()
      : null;
  const showTeamFlow = Boolean(previousTeamName && newTeamName && previousTeamName !== newTeamName);

  return (
    <div className="flex w-full flex-col items-center gap-2 py-1">
      {showDateSeparator ? (
        <div className="flex w-full items-center gap-3 py-1">
          <div className="h-px flex-1 bg-ink-200/80 dark:bg-soft-border-muted" aria-hidden />
          <span className="shrink-0 text-[11px] font-medium text-ink-500 dark:text-soft-text-secondary">{dateLabel}</span>
          <div className="h-px flex-1 bg-ink-200/80 dark:bg-soft-border-muted" aria-hidden />
        </div>
      ) : null}

      <div
        className={clsx(
          "w-full max-w-[min(100%,32rem)] rounded-[11px] border border-brand-200/70 bg-[#F8F6FF] px-4 py-3",
          "dark:border-brand-500/20 dark:bg-brand-950/30 dark:shadow-none",
        )}
      >
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center">
          <TransferNotificationIcon mode={content.mode} className="h-9 w-9 [&_svg]:h-4 [&_svg]:w-4" />
          <p className="text-sm font-semibold text-[#1F2937] dark:text-soft-text">{t("workspace.transferTitle")}</p>
          <TransferNotificationDescription content={content} />
          {showTeamFlow ? (
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5">
              <FlowChip>{previousTeamName}</FlowChip>
              <span className="text-xs text-ink-400 dark:text-soft-text-tertiary" aria-hidden>
                →
              </span>
              <FlowChip>{newTeamName}</FlowChip>
            </div>
          ) : null}
          {content.actorName ? (
            <p className="text-[11px] text-ink-500 dark:text-soft-text-tertiary">
              {replaceTransferTokens(t("workspace.transferMetaBy"), { actor: content.actorName })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
