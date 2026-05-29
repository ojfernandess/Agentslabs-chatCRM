import clsx from "clsx";
import {
  ArrowRight,
  CalendarPlus,
  Flame,
  Frown,
  Kanban,
  Loader2,
  Sparkles,
  Tag,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  conversationId: string;
  onGenerateReply: () => void;
  generating: boolean;
  disabled: boolean;
};

const actions = [
  { id: "reply", icon: Sparkles, labelKey: "aiInsightsPage.actions.generateReply", primary: true },
  { id: "followup", icon: CalendarPlus, labelKey: "aiInsightsPage.actions.followUp", href: "reminders" },
  { id: "funnel", icon: Kanban, labelKey: "aiInsightsPage.actions.moveFunnel", href: "crm" },
  { id: "tag", icon: Tag, labelKey: "aiInsightsPage.actions.applyTag", href: "contacts" },
  { id: "transfer", icon: UserRound, labelKey: "aiInsightsPage.actions.transfer", href: "conversation" },
] as const;

export function SuggestedActions({ conversationId, onGenerateReply, generating, disabled }: Props) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const Icon = action.icon;
        if (action.id === "reply") {
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled || generating || !conversationId}
              onClick={onGenerateReply}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition hover:brightness-110 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              {t(action.labelKey)}
            </button>
          );
        }

        const href =
          action.href === "conversation"
            ? `/conversations/${conversationId}`
            : action.href === "crm"
              ? "/crm"
              : action.href === "reminders"
                ? "/reminders"
                : "/contacts";

        return (
          <Link
            key={action.id}
            to={href}
            className={clsx(
              "inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 shadow-sm transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900/50 dark:text-ink-100 dark:hover:bg-ink-800/60",
              !conversationId && "pointer-events-none opacity-40",
            )}
          >
            <Icon className="h-4 w-4 text-brand-500" />
            {t(action.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}

export type SmartAlertItem = {
  id: string;
  type: "angry" | "hot" | "waiting" | "opportunity";
  titleKey: string;
  bodyKey: string;
  bodyParams?: Record<string, string>;
  conversationId?: string;
  timeKey: string;
};

const ALERT_STYLE = {
  angry: "border-rose-200/80 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/20",
  hot: "border-orange-200/80 bg-orange-50/80 dark:border-orange-900/40 dark:bg-orange-950/20",
  waiting: "border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20",
  opportunity: "border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20",
} as const;

const ALERT_ICON = {
  angry: Frown,
  hot: Flame,
  waiting: CalendarPlus,
  opportunity: Sparkles,
} as const;

type SmartAlertsProps = {
  alerts: SmartAlertItem[];
};

export function SmartAlerts({ alerts }: SmartAlertsProps) {
  const { t } = useI18n();

  if (alerts.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.smartAlertsTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {alerts.map((alert) => {
          const Icon = ALERT_ICON[alert.type];
          const body = alert.bodyParams
            ? t(alert.bodyKey).replace(/\{(\w+)\}/g, (_, k) => alert.bodyParams?.[k] ?? "")
            : t(alert.bodyKey);
          return (
            <div
              key={alert.id}
              className={clsx("rounded-2xl border p-4 shadow-sm transition hover:shadow-md", ALERT_STYLE[alert.type])}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 dark:bg-ink-900/50">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-900 dark:text-ink-50">{t(alert.titleKey)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-400">{body}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-ink-500">{t(alert.timeKey)}</span>
                    {alert.conversationId ? (
                      <Link
                        to={`/conversations/${alert.conversationId}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t("aiInsightsPage.viewConversation")}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
