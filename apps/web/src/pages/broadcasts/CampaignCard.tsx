import clsx from "clsx";
import { format } from "date-fns";
import { Play, Trash2, MessageSquare, Bot, Users, BarChart3, Check, X, Ban } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { campaignDeliveryRate, campaignProgress, CHANNEL_LABEL_KEYS, type CampaignRow } from "./campaignTypes";

interface Props {
  row: CampaignRow;
  statusLabel: (s: string) => string;
  actionBusy: string | null;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
  onApprove?: (id: string, approve: boolean) => void;
  onCancel?: (id: string) => void;
}

const statusStyles: Record<string, string> = {
  DRAFT: "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
  RUNNING: "bg-amber-100 text-amber-900 dark:bg-amber-900/35 dark:text-amber-100",
  COMPLETED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/35 dark:text-emerald-100",
  FAILED: "bg-rose-100 text-rose-900 dark:bg-rose-900/35 dark:text-rose-100",
  CANCELLED: "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-400",
};

export function CampaignCard({ row, statusLabel, actionBusy, onStart, onDelete, onApprove, onCancel }: Props) {
  const { t, dateLocale } = useI18n();
  const progress = campaignProgress(row);
  const delivery = campaignDeliveryRate(row);
  const contactCount =
    row.status === "DRAFT" ? row.audienceCount ?? row._count?.recipients ?? 0 : row.totalRecipients;
  const creator = row.createdBy?.displayName?.trim() || row.createdBy?.name || "—";
  const lastRun = row.startedAt ?? row.createdAt;
  const channelKey = CHANNEL_LABEL_KEYS[(row.channel ?? "WHATSAPP").toUpperCase()] ?? "broadcastPage.channelWhatsapp";
  const pendingApproval = row.requiresApproval && row.approvalStatus === "PENDING";

  return (
    <article className="flex flex-col rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md dark:border-white/10 dark:bg-[#111C2B]/55">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{row.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <MessageSquare className="h-3 w-3" />
            {t(channelKey)}
          </span>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              statusStyles[row.status] ?? statusStyles.DRAFT,
            )}
          >
            {statusLabel(row.status)}
          </span>
          {pendingApproval ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-900/35 dark:text-violet-100">
              {t("broadcastPage.approvalPending")}
            </span>
          ) : null}
          {row.approvalStatus === "REJECTED" ? (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800 dark:bg-rose-900/35 dark:text-rose-100">
              {t("broadcastPage.approvalRejected")}
            </span>
          ) : null}
        </div>
      </div>

      {row.status !== "DRAFT" ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[10px] text-ink-500 dark:text-ink-400">
            <span>{t("broadcastPage.cardProgress")}</span>
            <span className="font-semibold tabular-nums text-ink-700 dark:text-ink-200">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                row.status === "RUNNING" ? "bg-amber-500" : "bg-brand-500",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="text-ink-500 dark:text-ink-400">{t("broadcastPage.cardContacts")}</dt>
          <dd className="font-semibold tabular-nums text-ink-800 dark:text-ink-100">{contactCount}</dd>
        </div>
        <div>
          <dt className="text-ink-500 dark:text-ink-400">{t("broadcastPage.cardDelivery")}</dt>
          <dd className="font-semibold tabular-nums text-ink-800 dark:text-ink-100">
            {delivery != null ? `${delivery}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-500 dark:text-ink-400">{t("broadcastPage.cardResponses")}</dt>
          <dd className="font-semibold tabular-nums text-ink-800 dark:text-ink-100">
            {row.responseCount != null ? row.responseCount : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-500 dark:text-ink-400">{t("broadcastPage.cardConversions")}</dt>
          <dd className="font-semibold tabular-nums text-ink-800 dark:text-ink-100">
            {row.conversionCount != null ? row.conversionCount : "—"}
          </dd>
        </div>
      </dl>

      {row.tags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.tags.slice(0, 4).map((x) => (
            <span
              key={x.tagId}
              className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-ink-700 dark:text-ink-200"
              style={{ borderColor: x.tag.color }}
            >
              {x.tag.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3 text-[10px] text-ink-500 dark:border-white/10 dark:text-ink-400">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" />
          {creator}
        </span>
        <span className="inline-flex items-center gap-1">
          <Bot className="h-3 w-3" />
          {t("broadcastPage.cardAiOff")}
        </span>
        <span className="inline-flex items-center gap-1">
          <BarChart3 className="h-3 w-3" />
          {format(new Date(lastRun), "dd/MM/yy HH:mm", { locale: dateLocale })}
        </span>
      </div>

      {pendingApproval && onApprove ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={actionBusy === row.id}
            onClick={() => onApprove(row.id, true)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {t("broadcastPage.approve")}
          </button>
          <button
            type="button"
            disabled={actionBusy === row.id}
            onClick={() => onApprove(row.id, false)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-950/30"
          >
            <X className="h-3.5 w-3.5" />
            {t("broadcastPage.reject")}
          </button>
        </div>
      ) : row.status === "DRAFT" && !pendingApproval && row.approvalStatus !== "REJECTED" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={actionBusy === row.id}
            onClick={() => onStart(row.id)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600"
          >
            <Play className="h-3.5 w-3.5" />
            {t("broadcastPage.start")}
          </button>
          <button
            type="button"
            disabled={actionBusy === row.id}
            onClick={() => onDelete(row.id)}
            className="rounded-lg border border-ink-200 px-3 py-2 text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:hover:bg-white/5"
            aria-label={t("broadcastPage.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : row.status === "RUNNING" && onCancel ? (
        <div className="mt-3">
          <button
            type="button"
            disabled={actionBusy === row.id}
            onClick={() => onCancel(row.id)}
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-950/30"
          >
            <Ban className="h-3.5 w-3.5" />
            {t("broadcastPage.cancelCampaign")}
          </button>
        </div>
      ) : row.sentCount > 0 ? (
        <p className="mt-2 text-[10px] tabular-nums text-ink-500 dark:text-ink-400">
          {row.sentCount}/{row.totalRecipients} · {t("broadcastPage.failed")} {row.failedCount}
        </p>
      ) : null}
    </article>
  );
}
