import clsx from "clsx";
import { Bot, ArrowRightLeft } from "lucide-react";
import { format, isToday } from "date-fns";
import { useI18n } from "@/i18n/I18nProvider";
import {
  replaceTransferTokens,
  type TransferNotificationContent,
} from "@/lib/transferNotification";

function DestinationHighlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold text-[#5B4DF7] dark:text-brand-300 dark:font-semibold">{children}</span>
  );
}

export function TransferNotificationIcon({
  mode,
  className,
}: {
  mode: TransferNotificationContent["mode"];
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#F3F0FF] text-[#6D4AFF]",
        "dark:bg-brand-500/15 dark:text-brand-300",
        className,
      )}
    >
      {mode === "bot" ? (
        <Bot className="h-5 w-5 animate-bot-head-nod" strokeWidth={2} aria-hidden />
      ) : (
        <ArrowRightLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
      )}
    </div>
  );
}

export function TransferNotificationDescription({
  content,
}: {
  content: TransferNotificationContent;
}) {
  const { t } = useI18n();

  if (content.mode === "fallback" || !content.contactName) {
    return (
      <p className="text-sm leading-snug text-[#64748B] dark:text-soft-text-secondary">
        {t("workspace.transferSuccessFallback")}
      </p>
    );
  }

  if (content.mode === "team" && content.teamName) {
    const text = replaceTransferTokens(t("workspace.transferToTeam"), {
      contact: content.contactName,
      team: content.teamName,
    });
    const teamIdx = text.indexOf(content.teamName);
    if (teamIdx >= 0) {
      return (
        <p className="text-sm leading-snug text-[#64748B] dark:text-soft-text-secondary">
          {text.slice(0, teamIdx)}
          <DestinationHighlight>{content.teamName}</DestinationHighlight>
          {text.slice(teamIdx + content.teamName.length)}
        </p>
      );
    }
  }

  if (content.mode === "agent" && content.agentName) {
    const text = replaceTransferTokens(t("workspace.transferToAgent"), {
      contact: content.contactName,
      agent: content.agentName,
    });
    const agentIdx = text.indexOf(content.agentName);
    if (agentIdx >= 0) {
      return (
        <p className="text-sm leading-snug text-[#64748B] dark:text-soft-text-secondary">
          {text.slice(0, agentIdx)}
          <DestinationHighlight>{content.agentName}</DestinationHighlight>
          {text.slice(agentIdx + content.agentName.length)}
        </p>
      );
    }
  }

  if (content.mode === "bot") {
    const template = content.botName ? t("workspace.transferToBotNamed") : t("workspace.transferToBot");
    const botLabel = content.botName ?? "";
    const text = replaceTransferTokens(template, {
      contact: content.contactName,
      bot: botLabel,
    });
    if (content.botName && text.includes(content.botName)) {
      const botIdx = text.indexOf(content.botName);
      return (
        <p className="text-sm leading-snug text-[#64748B] dark:text-soft-text-secondary">
          {text.slice(0, botIdx)}
          <DestinationHighlight>{content.botName}</DestinationHighlight>
          {text.slice(botIdx + content.botName.length)}
        </p>
      );
    }
    return <p className="text-sm leading-snug text-[#64748B] dark:text-soft-text-secondary">{text}</p>;
  }

  return (
    <p className="text-sm leading-snug text-[#64748B] dark:text-soft-text-secondary">
      {t("workspace.transferSuccessFallback")}
    </p>
  );
}

export function TransferNotificationMeta({
  content,
  createdAt,
}: {
  content: TransferNotificationContent;
  createdAt: number;
}) {
  const { t, dateLocale } = useI18n();
  const at = new Date(createdAt);
  const timeLabel = isToday(at)
    ? t("workspace.transferMetaNow")
    : format(at, "HH:mm", { locale: dateLocale });

  if (!content.actorName) {
    return <p className="text-xs text-ink-500 dark:text-soft-text-tertiary">{timeLabel}</p>;
  }

  return (
    <p className="text-xs text-ink-500 dark:text-soft-text-tertiary">
      {timeLabel}
      {" · "}
      {replaceTransferTokens(t("workspace.transferMetaBy"), { actor: content.actorName })}
    </p>
  );
}
