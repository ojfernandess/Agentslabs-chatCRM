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
      iconBg: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
    },
    {
      id: "conversations",
      label: t("inboxesPage.dashboard.kpiConversations"),
      value: stats.totalConversations.toLocaleString(),
      hint: t("inboxesPage.dashboard.kpiConversationsHint"),
      icon: MessageSquare,
      iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300",
    },
    {
      id: "members",
      label: t("inboxesPage.dashboard.kpiMembers"),
      value: String(stats.totalMemberSlots),
      hint: t("inboxesPage.dashboard.kpiMembersHint"),
      icon: Users,
      iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    {
      id: "connected",
      label: t("inboxesPage.dashboard.kpiConnected"),
      value: `${stats.connectedChannels}/${stats.inboxCount}`,
      hint: t("inboxesPage.dashboard.kpiConnectedHint"),
      icon: Plug,
      iconBg: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
    },
    {
      id: "whatsapp",
      label: t("inboxesPage.dashboard.kpiWhatsApp"),
      value: String(stats.whatsappReady),
      hint: t("inboxesPage.dashboard.kpiWhatsAppHint"),
      icon: Activity,
      iconBg: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5 dark:border-ink-700 dark:bg-ink-950/70"
        >
          <div className="min-w-0">
            <p className="text-2xl font-semibold tracking-tight text-[#111827] dark:text-ink-50">{card.value}</p>
            <p className="mt-0.5 text-sm font-medium text-[#111827] dark:text-ink-100">{card.label}</p>
            <p className="mt-0.5 text-xs text-[#64748B] dark:text-ink-400">{card.hint}</p>
          </div>
          <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", card.iconBg)}>
            <card.icon className="h-4 w-4" />
          </div>
        </div>
      ))}
    </div>
  );
}
