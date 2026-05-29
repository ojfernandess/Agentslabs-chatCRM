import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { AiInsightsConversationRow, ConversationInsightPayload } from "@/lib/conversationInsights";

type PreviewMessage = {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  time: string;
};

type Props = {
  conversation: AiInsightsConversationRow | null;
  insights: ConversationInsightPayload | null;
};

function toPreviewMessages(row: AiInsightsConversationRow | null, locale: string): PreviewMessage[] {
  if (!row?.messages?.length) return [];
  return row.messages
    .filter((m) => m.body?.trim())
    .slice(-6)
    .map((m, i) => ({
      id: `${i}-${m.createdAt}`,
      body: m.body!.trim(),
      direction: m.direction === "OUTBOUND" || m.direction === "outbound" ? "outbound" : "inbound",
      time: new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    }));
}

export function ConversationPreview({ conversation, insights }: Props) {
  const { t, locale } = useI18n();
  const messages = toPreviewMessages(conversation, locale);
  const contactName = conversation?.contact.name ?? t("aiInsightsPage.contact");

  if (!conversation) {
    return (
      <div className="rounded-2xl border border-ink-200/80 bg-ink-50/30 p-6 dark:border-ink-700/60 dark:bg-ink-900/20">
        <p className="text-center text-sm text-ink-500">{t("aiInsightsPage.previewEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200/80 bg-[#e5ddd5] shadow-sm dark:border-ink-700/60 dark:bg-[#0b141a]">
      <div className="border-b border-black/5 bg-[#f0f2f5] px-4 py-3 dark:border-white/5 dark:bg-ink-900/80">
        <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{contactName}</p>
        <p className="text-[10px] text-ink-500">{t("aiInsightsPage.previewSubtitle")}</p>
      </div>
      <div className="max-h-[280px] space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-center text-xs text-ink-600 dark:text-ink-400">{t("aiInsightsPage.noMessages")}</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={clsx("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}
            >
              <div
                className={clsx(
                  "max-w-[85%] rounded-2xl px-3 py-2 shadow-sm",
                  msg.direction === "outbound"
                    ? "rounded-br-md bg-[#d9fdd3] text-ink-900 dark:bg-emerald-900/60 dark:text-ink-50"
                    : "rounded-bl-md bg-white text-ink-900 dark:bg-ink-800 dark:text-ink-50",
                )}
              >
                <p className="text-sm leading-relaxed">{msg.body}</p>
                <p className="mt-1 text-right text-[10px] text-ink-500">{msg.time}</p>
              </div>
            </div>
          ))
        )}
        {insights && (insights.sentiment === "negative" || insights.sentiment === "frustrated" || insights.alerts.length > 0) ? (
          <div className="flex justify-center pt-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <AlertTriangle className="h-3.5 w-3.5" />
              {insights.alerts[0] ?? t("aiInsightsPage.aiDetectedAlert")}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
