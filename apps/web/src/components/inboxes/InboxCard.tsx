import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Bot, Check, ChevronDown, Copy, MoreHorizontal, Pencil } from "lucide-react";
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
import { isInboxEmailConfigured, parseInboxEmailFromChannelConfig } from "@/lib/inboxEmailConfig";
import { isInboxWhatsappConfigured, parseInboxWhatsappFromChannelConfig } from "@/lib/inboxWhatsappConfig";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

export type InboxPanelTab = "overview" | "integration" | "automation" | "team" | "diagnostics";

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

const TABS = [
  { id: "overview", labelKey: "inboxesPage.dashboard.tabOverview" },
  { id: "integration", labelKey: "inboxesPage.dashboard.tabIntegration" },
  { id: "automation", labelKey: "inboxesPage.dashboard.tabAutomation" },
  { id: "team", labelKey: "inboxesPage.dashboard.tabTeam" },
  { id: "diagnostics", labelKey: "inboxesPage.dashboard.tabDiagnostics" },
] as const;

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
  panelTab?: InboxPanelTab;
  onPanelTabChange?: (tab: InboxPanelTab) => void;
  onToggle: () => void;
  onEdit: () => void;
  onConfigure?: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onCopyId: () => void;
  onOpenEmail?: () => void;
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
  panelTab = "overview",
  onPanelTabChange,
  onToggle,
  onEdit,
  onConfigure,
  onDelete,
  onSetDefault,
  onCopyId,
  onOpenEmail,
  expandedContent,
}: Props) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const channelId = isInboxChannelId(row.channelType) ? row.channelType : null;
  const channelStyle = channelId ? INBOX_CHANNEL_STYLES[channelId] : null;
  const ready = inboxIsChannelReady(row.channelType, row.channelConfig, row.ingestToken, row.whatsappConfigured);
  const connection = inboxConnectionLabel(row.channelType, row.channelConfig, row.whatsappConfigured);
  const members = row.members ?? [];
  const bars = relativeActivityBars(row._count.conversations, maxConversations);
  const wa = row.channelType === "WHATSAPP" ? parseInboxWhatsappFromChannelConfig(row.channelConfig) : null;
  const email = row.channelType === "EMAIL" ? parseInboxEmailFromChannelConfig(row.channelConfig) : null;
  const waConfigured = Boolean(wa && (row.whatsappConfigured ?? isInboxWhatsappConfigured(wa)));
  const provider = waConfigured
    ? whatsappProviderLabel(wa?.whatsappProvider)
    : email && isInboxEmailConfigured(email)
      ? email.emailFromAddress || null
      : connection;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const wide = viewMode !== "grid" || open;

  const openDetails = () => {
    if (row.channelType === "EMAIL" && onOpenEmail) {
      onOpenEmail();
      return;
    }
    onToggle();
  };

  return (
    <article
      className={clsx(
        "overflow-hidden rounded-xl border bg-white dark:bg-ink-950/70",
        open ? "border-brand-200 dark:border-brand-800/60" : "border-[#E5E7EB] dark:border-ink-700",
        viewMode === "grid" && open && "col-span-full",
        viewMode === "grid" && !open && "h-full",
      )}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className={clsx("flex flex-col gap-4", wide && "xl:flex-row xl:items-start xl:justify-between")}>
          <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            type="button"
            onClick={openDetails}
            className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-expanded={open}
          >
            <InboxChannelIcon channelType={row.channelType} size="lg" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openDetails}
                className="truncate text-left text-base font-semibold text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-ink-50"
              >
                {row.name}
              </button>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  channelStyle?.badge ?? "bg-slate-100 text-slate-700",
                )}
              >
                {channelLabel(row.channelType)}
              </span>
              {row.isDefault ? (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-200">
                  {t("inboxesPage.defaultBadge")}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#64748B] dark:text-ink-400">
              {t("inboxesPage.members")}: {row._count.members}
              {" · "}
              {t("inboxesPage.conversations")}: {row._count.conversations}
              {connection ? ` · ${t("inboxesPage.dashboard.connection")}: ${connection}` : ""}
            </p>
            <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-[#64748B] dark:text-ink-400">
              <Bot className="mt-0.5 h-3 w-3 shrink-0 text-violet-600" />
              <span>
                {t("inboxesPage.agentBotField")}:{" "}
                <span className="font-medium text-[#111827] dark:text-ink-100">
                  {row.agentBot
                    ? `${row.agentBot.name}${!row.agentBot.isActive ? ` ${t("inboxesPage.wizard.agentBotInactive")}` : ""}`
                    : t("inboxesPage.agentBotOrgDefault")}
                </span>
              </span>
            </p>
            {waConfigured && provider ? (
              <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  {t("inboxesPage.dashboard.whatsappOnInbox")} · {provider}
                </span>
              </p>
            ) : null}
            <p className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-[#64748B]">
              <span>{t("inboxesPage.inboxId")}</span>
              <span className="truncate">{row.id}</span>
              <button
                type="button"
                onClick={onCopyId}
                className="rounded p-0.5 text-[#64748B] hover:bg-slate-100 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-ink-800"
                aria-label={t("inboxesPage.inboxId")}
              >
                {copiedId === row.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </p>
          </div>
          </div>
          <div className={clsx("flex min-w-0 flex-col gap-3", wide && "xl:max-w-md xl:shrink-0 xl:flex-row xl:items-start")}>
            <div className={clsx(wide ? "flex flex-wrap items-end gap-4" : "grid w-full grid-cols-2 gap-3 border-t border-[#E5E7EB] pt-3 dark:border-ink-800")}>
              <div>
                <p className="mb-1 text-[11px] font-medium text-[#64748B]">{t("inboxesPage.dashboard.activity")}</p>
                <div className="flex h-8 items-end gap-0.5" aria-hidden>
                  {bars.map((h, i) => (
                    <span
                      key={i}
                      className="w-1.5 rounded-sm bg-brand-500/80"
                      style={{ height: `${Math.round(h * 100)}%` }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-lg font-semibold leading-none text-[#111827] dark:text-ink-50">{row._count.conversations}</p>
                <p className="mt-1 text-[11px] text-[#64748B]">{t("inboxesPage.conversations")}</p>
              </div>
              <div>
                <p className="text-lg font-semibold leading-none text-[#111827] dark:text-ink-50">{row._count.members}</p>
                <p className="mt-1 text-[11px] text-[#64748B]">{t("inboxesPage.dashboard.agents")}</p>
                {members.length > 0 ? (
                  <div className="mt-1 flex -space-x-1.5">
                    {members.slice(0, 4).map((m) => (
                      <span
                        key={m.id}
                        title={m.user.name}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-800 ring-2 ring-white dark:bg-brand-950 dark:text-brand-200 dark:ring-ink-950"
                      >
                        {memberInitials(m.user.name)}
                      </span>
                    ))}
                    {members.length > 4 ? (
                      <span className="flex h-6 items-center pl-2 text-[10px] font-semibold text-[#64748B]">
                        +{members.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#111827] dark:text-ink-50">{formatInboxDate(row.createdAt, locale)}</p>
                <p className="mt-1 text-[11px] text-[#64748B]">{t("inboxesPage.dashboard.created")}</p>
              </div>
            </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                ready
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-500" : "bg-amber-500")} />
              {ready ? t("inboxesPage.dashboard.statusActive") : t("inboxesPage.dashboard.statusNeedsSetup")}
            </span>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-600 dark:hover:bg-ink-800"
              aria-expanded={open}
              aria-label={row.name}
            >
              <ChevronDown className={clsx("h-4 w-4 transition", open && "rotate-180")} />
            </button>
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#111827] hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("common.edit")}</span>
                </button>
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    className="rounded-lg border border-[#E5E7EB] p-1.5 text-[#64748B] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-600 dark:hover:bg-ink-800"
                    aria-label={t("inboxesPage.dashboard.moreActions")}
                    aria-expanded={menuOpen}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuOpen ? (
                    <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[#E5E7EB] bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900">
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-[#111827] hover:bg-slate-50 dark:text-ink-100 dark:hover:bg-ink-800"
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit();
                        }}
                      >
                        {t("inboxesPage.dashboard.menuEdit")}
                      </button>
                      {onConfigure ? (
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm text-[#111827] hover:bg-slate-50 dark:text-ink-100 dark:hover:bg-ink-800"
                          onClick={() => {
                            setMenuOpen(false);
                            onConfigure();
                          }}
                        >
                          {t("inboxesPage.dashboard.menuIntegration")}
                        </button>
                      ) : null}
                      {!row.isDefault ? (
                        <button
                          type="button"
                          disabled={patching}
                          className="block w-full px-3 py-2 text-left text-sm text-[#111827] hover:bg-slate-50 disabled:opacity-40 dark:text-ink-100 dark:hover:bg-ink-800"
                          onClick={() => {
                            setMenuOpen(false);
                            onSetDefault();
                          }}
                        >
                          {t("inboxesPage.setDefault")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={!canDelete || patching}
                        className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/40"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete();
                        }}
                      >
                        {t("inboxesPage.dashboard.menuDelete")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
          </div>
        </div>
      </div>

      {open && isAdmin && onPanelTabChange ? (
        <div className="flex gap-1 overflow-x-auto border-t border-[#E5E7EB] px-3 dark:border-ink-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onPanelTabChange(tab.id)}
              className={clsx(
                "shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                panelTab === tab.id
                  ? "border-brand-600 text-brand-700 dark:text-brand-300"
                  : "border-transparent text-[#64748B] hover:text-[#111827] dark:hover:text-ink-100",
              )}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      ) : null}

      {open && expandedContent ? (
        <div className="border-t border-[#E5E7EB] bg-[#F7F8FC] px-4 py-5 dark:border-ink-800 dark:bg-ink-950/40 sm:px-5">
          {expandedContent}
        </div>
      ) : null}
    </article>
  );
}
