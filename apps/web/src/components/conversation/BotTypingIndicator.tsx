import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";

type BotTypingIndicatorProps = {
  botName?: string;
  variant?: "bubble" | "inline";
  className?: string;
};

function TypingDots({ dotClassName }: { dotClassName: string }) {
  return (
    <>
      <span className={clsx(dotClassName, "[animation-delay:-0.2s]")} />
      <span className={clsx(dotClassName, "[animation-delay:-0.1s]")} />
      <span className={dotClassName} />
    </>
  );
}

export function BotTypingIndicator({
  botName,
  variant = "bubble",
  className,
}: BotTypingIndicatorProps) {
  const { t } = useI18n();
  const label = t("conversationDetail.botTypingMessage").replace(
    "{name}",
    botName?.trim() || t("conversationDetail.botInAttendance"),
  );

  if (variant === "inline") {
    return (
      <span
        className={clsx("inline-flex min-w-0 items-center gap-1.5 text-xs italic text-violet-700 dark:text-violet-300", className)}
        aria-live="polite"
        aria-label={label}
      >
        <span className="inline-flex items-center gap-0.5">
          <TypingDots dotClassName="inline-block h-1 w-1 animate-bounce rounded-full bg-violet-500 dark:bg-violet-400" />
        </span>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <div
      className={clsx(
        "crm-bubble crm-bubble-out rounded-[16px] border border-brand-500/25 p-4 dark:border-brand-400/30",
        className,
      )}
      aria-live="polite"
      aria-label={label}
    >
      <p className="crm-bubble-agent-name mb-2 text-xs font-semibold">
        {botName?.trim() || t("conversationDetail.botInAttendance")}
      </p>
      <div className="flex items-center gap-1 px-0.5">
        <TypingDots dotClassName="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
      </div>
    </div>
  );
}
