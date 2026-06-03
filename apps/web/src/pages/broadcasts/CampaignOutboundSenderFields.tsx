import { useEffect, useState } from "react";
import clsx from "clsx";
import { Bot, Headset, User } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";

export type OutboundSenderMode = "default" | "agent" | "bot";

interface SenderOptions {
  botAvailable: boolean;
  botName: string | null;
  creatorName: string | null;
}

interface Props {
  inboxId: string;
  value: OutboundSenderMode;
  onChange: (mode: OutboundSenderMode) => void;
}

export function CampaignOutboundSenderFields({ inboxId, value, onChange }: Props) {
  const { t } = useI18n();
  const [options, setOptions] = useState<SenderOptions | null>(null);

  useEffect(() => {
    if (!inboxId) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    void api
      .get<SenderOptions>(`/broadcasts/sender-options?inboxId=${encodeURIComponent(inboxId)}`)
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {
        if (!cancelled) setOptions({ botAvailable: false, botName: null, creatorName: null });
      });
    return () => {
      cancelled = true;
    };
  }, [inboxId]);

  if (!inboxId) return null;

  const creatorLabel = options?.creatorName?.trim() || t("broadcastPage.outboundSenderAgentFallback");
  const botLabel = options?.botName?.trim() || t("broadcastPage.outboundSenderBotFallback");

  return (
    <div className="rounded-xl border border-ink-200/80 p-3 dark:border-white/10">
      <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.outboundSenderTitle")}</h3>
      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("broadcastPage.outboundSenderHint")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onChange("default")}
          className={clsx(
            "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
            value === "default"
              ? "border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40"
              : "border-ink-200 hover:bg-ink-50 dark:border-white/10 dark:hover:bg-white/5",
          )}
        >
          <span className="inline-flex items-center gap-1 font-semibold text-ink-800 dark:text-ink-100">
            <User className="h-3.5 w-3.5" />
            {t("broadcastPage.outboundSenderDefault")}
          </span>
          <p className="mt-0.5 text-[10px] text-ink-500">{t("broadcastPage.outboundSenderDefaultHint")}</p>
        </button>
        <button
          type="button"
          onClick={() => onChange("agent")}
          className={clsx(
            "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
            value === "agent"
              ? "border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40"
              : "border-ink-200 hover:bg-ink-50 dark:border-white/10 dark:hover:bg-white/5",
          )}
        >
          <span className="inline-flex items-center gap-1 font-semibold text-ink-800 dark:text-ink-100">
            <Headset className="h-3.5 w-3.5" />
            {t("broadcastPage.outboundSenderAgent")}
          </span>
          <p className="mt-0.5 text-[10px] text-ink-500">{creatorLabel}</p>
        </button>
        <button
          type="button"
          disabled={!options?.botAvailable}
          onClick={() => onChange("bot")}
          className={clsx(
            "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
            value === "bot"
              ? "border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40"
              : "border-ink-200 hover:bg-ink-50 dark:border-white/10 dark:hover:bg-white/5",
            !options?.botAvailable && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="inline-flex items-center gap-1 font-semibold text-ink-800 dark:text-ink-100">
            <Bot className="h-3.5 w-3.5" />
            {t("broadcastPage.outboundSenderBot")}
          </span>
          <p className="mt-0.5 text-[10px] text-ink-500">
            {options?.botAvailable ? botLabel : t("broadcastPage.outboundSenderBotUnavailable")}
          </p>
        </button>
      </div>
    </div>
  );
}
