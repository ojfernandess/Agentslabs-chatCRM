import type { ReactNode } from "react";
import clsx from "clsx";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { InboxChannelIcon } from "@/components/inboxes/InboxChannelIcon";
import {
  INBOX_CHANNEL_STYLES,
  formatInboxDate,
  inboxConnectionLabel,
  inboxIsChannelReady,
  isInboxChannelId,
  memberInitials,
  relativeActivityBars,
} from "@/lib/inboxChannelUi";
import { isInboxWhatsappConfigured, parseInboxWhatsappFromChannelConfig } from "@/lib/inboxWhatsappConfig";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

export type InboxCardRow = {
  id: string;
  name: string;
  description: string | null;
  channelType: string;
  isDefault: boolean;
  ingestToken?: string | null;
  channelConfig?: unknown | null;
  whatsappConfigured?: boolean;
  createdAt?: string;
  agentBot?: { id: string; name: string; isActive: boolean } | null;
  members?: Array<{ id: string; userId: string; user: { id: string; name: string; email: string } }>;
  _count: { members: number; conversations: number };
};

type Props = {
  row: InboxCardRow;
  open: boolean;
  viewMode: "list" | "grid";
  maxConversations: number;
  locale: string;
  isAdmin: boolean;
  canDelete: boolean;
  patching: boolean;
  copiedId: string | null;
  channelLabel: (ct: string) => string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onCopyId: () => void;
  expandedContent?: ReactNode;
};

export function InboxCard({
  row,
  open,
  viewMode,
  maxConversations,
  locale,
  isAdmin,
  canDelete,
  patching,
  copiedId,
  channelLabel,
  onToggle,
  onEdit,
  onDelete,
  onSetDefault,
  onCopyId,
  expandedContent,
}: Props) {
  const { t } = useI18n();
  const channelId = isInboxChannelId(row.channelType) ? row.channelType : null;
  const channelStyle = channelId ? INBOX_CHANNEL_STYLES[channelId] : null;
  const ready = inboxIsChannelReady(row.channelType, row.channelConfig, row.ingestToken, row.whatsappConfigured);
  const connection = inboxConnectionLabel(row.channelType, row.channelConfig, row.whatsappConfigured);
  const members = row.members ?? [];
  const bars = relativeActivityBars(row._count.conversations, maxConversations);
  const showMembers = members.length > 0;

  const statusPill = ready ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-500/20 dark:bg-emerald-950/40 dark:text-emerald-200">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {t("inboxesPage.dashboard.statusActive")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-500/25 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {t("inboxesPage.dashboard.statusNeedsSetup")}
    </span>
  );

  const headerActions = isAdmin ? (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-200 dark:hover:border-brand-700"
      >
        <Pencil className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("common.edit")}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={!canDelete || patching}
        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:bg-ink-900 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("common.delete")}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
        aria-label={t("inboxesPage.dashboard.moreActions")}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  const cardInner = (
    <>
      <div
        className={clsx(
          "flex gap-4 p-4 sm:p-5",
          viewMode === "list" ? "flex-col lg:flex-row lg:items-center" : "flex-col",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className={clsx(
            "flex min-w-0 flex-1 gap-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl",
            viewMode === "grid" ? "flex-col sm:flex-row" : "",
          )}
        >
          <div className="flex items-start gap-3 sm:gap-4">
            <InboxChannelIcon channelType={row.channelType} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">{row.name}</h3>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    channelStyle?.badge ?? "bg-slate-100 text-slate-700",
                  )}
                >
                  {channelLabel(row.channelType)}
                </span>
                {row.isDefault ? (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
                    {t("inboxesPage.defaultBadge")}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                {t("inboxesPage.memberCount")}: {row._count.members} · {t("inboxesPage.conversations")}:{" "}
                {row._count.conversations}
                {connection ? (
                  <>
                    {" "}
                    · {t("inboxesPage.dashboard.connection")}: {connection}
                  </>
                ) : null}
              </p>

              {row.agentBot ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-violet-700 dark:text-violet-300">
                  <Bot className="h-3 w-3 shrink-0" />
                  {t("inboxesPage.agentBotField")}: {row.agentBot.name}
                  {!row.agentBot.isActive ? ` ${t("inboxesPage.wizard.agentBotInactive")}` : ""}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-500">{t("inboxesPage.agentBotOrgDefault")}</p>
              )}

              {row.channelType === "WHATSAPP" ? (() => {
                const wa = parseInboxWhatsappFromChannelConfig(row.channelConfig);
                const waOk = row.whatsappConfigured ?? isInboxWhatsappConfigured(wa);
                return (
                  <p
                    className={clsx(
                      "mt-0.5 text-[11px] font-medium",
                      waOk ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-200",
                    )}
                  >
                    {waOk
                      ? `${t("inboxesPage.wizard.whatsappMeta.inboxStatusConfigured")} · ${whatsappProviderLabel(wa.whatsappProvider)}`
                      : t("inboxesPage.wizard.whatsappMeta.inboxStatusNotConfigured")}
                  </p>
                );
              })() : null}

              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  {t("inboxesPage.inboxId")}
                </span>
                <code className="max-w-[14rem] truncate rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-700 dark:bg-ink-800 dark:text-ink-200 sm:max-w-xs">
                  {row.id}
                </code>
                <button
                  type="button"
                  className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyId();
                  }}
                >
                  {copiedId === row.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </button>

        {viewMode === "list" ? (
          <>
            <div className="hidden shrink-0 flex-col items-center justify-center gap-2 border-l border-ink-100 px-4 dark:border-ink-800 lg:flex">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                {t("inboxesPage.dashboard.agents")}
              </p>
              {showMembers ? (
                <div className="flex -space-x-2">
                  {members.slice(0, 3).map((m) => (
                    <span
                      key={m.id}
                      title={m.user.name}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-brand-400 to-violet-500 text-[10px] font-bold text-white dark:border-ink-950"
                    >
                      {memberInitials(m.user.name)}
                    </span>
                  ))}
                  {members.length > 3 ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-ink-200 text-[10px] font-bold text-ink-700 dark:border-ink-950 dark:bg-ink-700 dark:text-ink-100">
                      +{members.length - 3}
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="text-xs text-ink-400">—</span>
              )}
            </div>

            <div className="hidden shrink-0 flex-col items-center justify-center gap-1 border-l border-ink-100 px-4 dark:border-ink-800 lg:flex">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                {t("inboxesPage.dashboard.activity")}
              </p>
              <div className="flex h-10 items-end gap-0.5">
                {bars.map((h, i) => (
                  <span
                    key={i}
                    className="w-1.5 rounded-sm bg-brand-400/80 dark:bg-brand-500/70"
                    style={{ height: `${Math.round(h * 100)}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-col justify-center gap-2 border-ink-100 px-0 lg:border-l lg:px-4 dark:border-ink-800">
              <div className="grid grid-cols-2 gap-3 text-center lg:grid-cols-1 lg:text-left">
                <div>
                  <p className="text-[10px] font-medium uppercase text-ink-400">{t("inboxesPage.conversations")}</p>
                  <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{row._count.conversations}</p>
                </div>
                <div className="lg:hidden">
                  <p className="text-[10px] font-medium uppercase text-ink-400">{t("inboxesPage.memberCount")}</p>
                  <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{row._count.members}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {statusPill}
                <span className="text-[11px] text-ink-500">
                  {t("inboxesPage.dashboard.created")} {formatInboxDate(row.createdAt, locale)}
                </span>
              </div>
              {!row.isDefault && isAdmin ? (
                <button
                  type="button"
                  disabled={patching}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetDefault();
                  }}
                  className="text-left text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t("inboxesPage.setDefault")}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            {statusPill}
            <span className="text-[11px] text-ink-500">
              {row._count.conversations} {t("inboxesPage.conversations").toLowerCase()}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg p-1 text-ink-400"
            aria-expanded={open}
          >
            <ChevronDown className={clsx("h-5 w-5 transition", open && "rotate-180")} />
          </button>
          {headerActions}
        </div>

        <div className="hidden lg:block">{headerActions}</div>
      </div>

      {open && expandedContent ? (
        <div className="border-t border-ink-100 bg-ink-50/50 px-4 pb-5 pt-4 dark:border-ink-800 dark:bg-ink-950/30 sm:px-5">
          {expandedContent}
        </div>
      ) : null}
    </>
  );

  return (
    <article
      className={clsx(
        "overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:shadow-md dark:bg-ink-950/70",
        open ? "border-brand-200 ring-1 ring-brand-500/10 dark:border-brand-800/50" : "border-ink-200/80 dark:border-ink-700/80",
      )}
    >
      {cardInner}
    </article>
  );
}
