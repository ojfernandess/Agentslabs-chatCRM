import { useCallback, useEffect, useState } from "react";
import { BarChart3, Copy, Loader2, Palette, Zap } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import type { ChatbotFlowNode, ChatbotFlowSettings, ChatbotFlowTheme } from "./chatbotFlowTypes";

export const DEFAULT_CHATBOT_THEME: ChatbotFlowTheme = {
  primaryColor: "#ff6b2c",
  backgroundColor: "#f4f5f7",
  botBubbleColor: "#ffffff",
  guestBubbleColor: "#fff4ed",
  fontFamily: "system-ui, sans-serif",
  borderRadius: 16,
};

interface Analytics {
  sessionsTotal: number;
  sessionsLast7Days: number;
  byStatus: Record<string, number>;
  completionRate: number;
  invalidInputCount: number;
  interactionsLast7Days: number;
}

interface Props {
  flowId: string;
  publicId: string;
  isPublished: boolean;
  flowNodes: ChatbotFlowNode[];
  theme: ChatbotFlowTheme;
  settings: ChatbotFlowSettings;
  onThemeChange: (theme: ChatbotFlowTheme) => void;
  onSettingsChange: (settings: ChatbotFlowSettings) => void;
}

export function ChatbotPlatformPanel({
  flowId,
  publicId,
  isPublished,
  flowNodes,
  theme,
  settings,
  onThemeChange,
  onSettingsChange,
}: Props) {
  const { t } = useI18n();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const embedOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = `${embedOrigin}/chatbot/${publicId}`;
  const iframeSnippet = `<iframe src="${embedUrl}" width="400" height="640" style="border:0;border-radius:16px;" title="${publicId}"></iframe>`;

  const loadAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const res = await api.get<{ analytics: Analytics }>(`/automation/chatbot-flows/${flowId}/analytics`);
      setAnalytics(res.analytics);
    } catch {
      setAnalytics(null);
    } finally {
      setLoadingAnalytics(false);
    }
  }, [flowId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const commands = settings.events?.commands ?? [];
  const patchTheme = (p: Partial<ChatbotFlowTheme>) => onThemeChange({ ...theme, ...p });
  const patchEvents = (p: Partial<NonNullable<ChatbotFlowSettings["events"]>>) =>
    onSettingsChange({
      ...settings,
      events: { ...settings.events, ...p },
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
          <Palette className="h-4 w-4" />
          {t("chatbotPage.themeTitle")}
        </h3>
        <p className="mt-1 text-xs text-ink-500">{t("chatbotPage.themeHint")}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(
            [
              ["primaryColor", t("chatbotPage.themePrimary")],
              ["backgroundColor", t("chatbotPage.themeBackground")],
              ["botBubbleColor", t("chatbotPage.themeBotBubble")],
              ["guestBubbleColor", t("chatbotPage.themeGuestBubble")],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{label}</span>
              <input
                type="color"
                className="h-9 w-full cursor-pointer rounded-lg border border-ink-200 dark:border-ink-700"
                value={theme[key] ?? DEFAULT_CHATBOT_THEME[key]}
                onChange={(e) => patchTheme({ [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="col-span-2 block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.themeHeader")}</span>
            <input
              className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-800"
              value={theme.headerTitle ?? ""}
              onChange={(e) => patchTheme({ headerTitle: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.themeRadius")}</span>
            <input
              type="number"
              min={0}
              max={32}
              className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-800"
              value={theme.borderRadius ?? 16}
              onChange={(e) => patchTheme({ borderRadius: Number(e.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
          {t("chatbotPage.embedTitle")}
        </h3>
        <p className="mt-1 text-xs text-ink-500">{t("chatbotPage.embedHint")}</p>
        {!isPublished ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {t("chatbotPage.embedPublishWarning")}
          </p>
        ) : null}
        <div className="mt-3 space-y-2 text-xs">
          <div>
            <span className="font-semibold text-ink-600">{t("chatbotPage.embedUrl")}</span>
            <div className="mt-1 flex gap-1">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-50 px-2 py-1.5 dark:bg-ink-800">{embedUrl}</code>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-ink-200 px-2 dark:border-ink-600"
                onClick={() => void copyText("url", embedUrl)}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            {copied === "url" ? <span className="text-[10px] text-emerald-600">{t("chatbotPage.copied")}</span> : null}
          </div>
          <div>
            <span className="font-semibold text-ink-600">{t("chatbotPage.embedIframe")}</span>
            <textarea
              readOnly
              rows={3}
              className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-50 px-2 py-1.5 font-mono text-[10px] dark:border-ink-600 dark:bg-ink-800"
              value={iframeSnippet}
            />
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-brand-600"
              onClick={() => void copyText("iframe", iframeSnippet)}
            >
              {copied === "iframe" ? t("chatbotPage.copied") : t("chatbotPage.copyEmbed")}
            </button>
          </div>
          <p className="text-[10px] text-ink-400">
            API: <code>GET /api/v1/public/chatbot/{publicId}</code>
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
          <Zap className="h-4 w-4" />
          {t("chatbotPage.eventsTitle")}
        </h3>
        <p className="mt-1 text-xs text-ink-500">{t("chatbotPage.eventsHint")}</p>
        <label className="mt-3 block text-xs">
          <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.invalidReplyMessage")}</span>
          <textarea
            rows={2}
            placeholder={t("chatbotPage.invalidReplyPlaceholder")}
            className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-800"
            value={settings.events?.invalidReplyMessage ?? ""}
            onChange={(e) => patchEvents({ invalidReplyMessage: e.target.value || undefined })}
          />
        </label>
        <label className="mt-3 block text-xs">
          <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.commandsLabel")}</span>
          <textarea
            rows={3}
            placeholder={t("chatbotPage.commandsPlaceholder")}
            className="w-full rounded-lg border border-ink-200 px-2 py-1.5 font-mono text-sm dark:border-ink-600 dark:bg-ink-800"
            value={commands.map((c) => `${c.trigger} → ${c.targetNodeId}`).join("\n")}
            onChange={(e) => {
              const next = e.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                  const [trigger, targetNodeId] = line.split("→").map((x) => x.trim());
                  return { trigger: trigger ?? "", targetNodeId: targetNodeId ?? "" };
                })
                .filter((c) => c.trigger && c.targetNodeId);
              patchEvents({ commands: next.length ? next : undefined });
            }}
          />
        </label>
        {flowNodes.length > 0 ? (
          <p className="mt-1 text-[10px] text-ink-400">{t("chatbotPage.commandsNodeHint")}</p>
        ) : null}
      </section>

      <section className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
            <BarChart3 className="h-4 w-4" />
            {t("chatbotPage.analyticsTitle")}
          </h3>
          <button
            type="button"
            className="text-xs font-semibold text-brand-600"
            onClick={() => void loadAnalytics()}
          >
            {t("chatbotPage.refresh")}
          </button>
        </div>
        {loadingAnalytics ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
          </div>
        ) : analytics ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
              <dt className="text-ink-500">{t("chatbotPage.analyticsSessions")}</dt>
              <dd className="text-lg font-bold text-ink-900 dark:text-ink-50">{analytics.sessionsTotal}</dd>
            </div>
            <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
              <dt className="text-ink-500">{t("chatbotPage.analyticsCompletion")}</dt>
              <dd className="text-lg font-bold text-ink-900 dark:text-ink-50">{analytics.completionRate}%</dd>
            </div>
            <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
              <dt className="text-ink-500">{t("chatbotPage.analyticsLast7")}</dt>
              <dd className="text-lg font-bold text-ink-900 dark:text-ink-50">{analytics.sessionsLast7Days}</dd>
            </div>
            <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
              <dt className="text-ink-500">{t("chatbotPage.analyticsInvalid")}</dt>
              <dd className="text-lg font-bold text-ink-900 dark:text-ink-50">{analytics.invalidInputCount}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-xs text-ink-500">{t("chatbotPage.analyticsEmpty")}</p>
        )}
      </section>
    </div>
  );
}
