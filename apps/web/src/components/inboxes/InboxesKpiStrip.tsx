import clsx from "clsx";
import { Activity, Inbox, MessageSquare, Plug, Users } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type InboxKpiStats = {
  inboxCount: number;
  totalConversations: number;
  totalMemberSlots: number;
  connectedChannels: number;
  whatsappReady: number;
};

type KpiCard = {
  id: string;
  label: string;
  value: string;
  hint: string;
  icon: typeof Inbox;
  accent: string;
  iconBg: string;
};

type Props = {
  stats: InboxKpiStats;
};

export function InboxesKpiStrip({ stats }: Props) {
  const { t } = useI18n();

  const cards: KpiCard[] = [
    {
      id: "inboxes",
      label: t("inboxesPage.dashboard.kpiActiveInboxes"),
      value: String(stats.inboxCount),
      hint: t("inboxesPage.dashboard.kpiActiveInboxesHint"),
      icon: Inbox,
      accent: "text-violet-600 dark:text-violet-400",
      iconBg: "bg-violet-500/10 ring-violet-500/20",
    },
    {
      id: "conversations",
      label: t("inboxesPage.dashboard.kpiConversations"),
      value: stats.totalConversations.toLocaleString(),
      hint: t("inboxesPage.dashboard.kpiConversationsHint"),
      icon: MessageSquare,
      accent: "text-blue-600 dark:text-blue-400",
      iconBg: "bg-blue-500/10 ring-blue-500/20",
    },
    {
      id: "members",
      label: t("inboxesPage.dashboard.kpiMembers"),
      value: String(stats.totalMemberSlots),
      hint: t("inboxesPage.dashboard.kpiMembersHint"),
      icon: Users,
      accent: "text-emerald-600 dark:text-emerald-400",
      iconBg: "bg-emerald-500/10 ring-emerald-500/20",
    },
    {
      id: "connected",
      label: t("inboxesPage.dashboard.kpiConnected"),
      value: `${stats.connectedChannels}/${stats.inboxCount}`,
      hint: t("inboxesPage.dashboard.kpiConnectedHint"),
      icon: Plug,
      accent: "text-amber-600 dark:text-amber-400",
      iconBg: "bg-amber-500/10 ring-amber-500/20",
    },
    {
      id: "whatsapp",
      label: t("inboxesPage.dashboard.kpiWhatsApp"),
      value: String(stats.whatsappReady),
      hint: t("inboxesPage.dashboard.kpiWhatsAppHint"),
      icon: Activity,
      accent: "text-rose-600 dark:text-rose-400",
      iconBg: "bg-rose-500/10 ring-rose-500/20",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.id}
          className="group relative overflow-hidden rounded-2xl border border-ink-200/80 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-ink-700/80 dark:bg-ink-950/60 dark:hover:border-brand-800/60"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{card.label}</p>
              <p className={clsx("mt-1 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50", card.accent)}>
                {card.value}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-ink-500 dark:text-ink-400">{card.hint}</p>
            </div>
            <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1", card.iconBg)}>
              <card.icon className={clsx("h-5 w-5", card.accent)} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
