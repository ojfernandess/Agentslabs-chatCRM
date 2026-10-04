import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Bot, ChevronDown, MoreHorizontal, Pencil } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { InboxChannelIcon } from "@/components/inboxes/InboxChannelIcon";
import {
  INBOX_CHANNEL_STYLES,
  formatInboxDate,
  inboxIsChannelReady,
  isInboxChannelId,
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
  locale,
  isAdmin,
  canDelete,
  patching,
  channelLabel,
  panelTab = "overview",
  onPanelTabChange,
  onToggle,
  onEdit,
  onConfigure,
  onDelete,
  onSetDefault,
  onOpenEmail,
  expandedContent,
}: Props) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const channelId = isInboxChannelId(row.channelType) ? row.channelType : null;
  const channelStyle = channelId ? INBOX_CHANNEL_STYLES[channelId] : null;
  const ready = inboxIsChannelReady(row.channelType, row.channelConfig, row.ingestToken, row.whatsappConfigured);
  const wa = row.channelType === "WHATSAPP" ? parseInboxWhatsappFromChannelConfig(row.channelConfig) : null;
  const email = row.channelType === "EMAIL" ? parseInboxEmailFromChannelConfig(row.channelConfig) : null;
  const provider =
    wa && (row.whatsappConfigured ?? isInboxWhatsappConfigured(wa))
      ? whatsappProviderLabel(wa.whatsappProvider)
      : email && isInboxEmailConfigured(email)
        ? email.emailFromAddress || null
        : null;

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
        viewMode === "grid" && "h-full",
      )}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
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
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#64748B] dark:text-ink-400">
              {provider ? <span>{provider}</span> : <span>{channelLabel(row.channelType)}</span>}
              {row.agentBot ? (
                <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
                  <Bot className="h-3 w-3" />
                  {row.agentBot.name}
                  {!row.agentBot.isActive ? ` ${t("inboxesPage.wizard.agentBotInactive")}` : ""}
                </span>
              ) : (
                <span>{t("inboxesPage.agentBotOrgDefault")}</span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={clsx(
                "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex",
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label={t("inboxesPage.conversations")} value={String(row._count.conversations)} />
          <Metric label={t("inboxesPage.dashboard.agents")} value={String(row._count.members)} />
          <Metric label={t("inboxesPage.dashboard.activity")} value={ready ? t("inboxesPage.dashboard.statusActive") : t("inboxesPage.dashboard.statusNeedsSetup")} />
          <Metric label={t("inboxesPage.dashboard.created")} value={formatInboxDate(row.createdAt, locale)} />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748B] dark:text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#111827] dark:text-ink-50">{value}</p>
    </div>
  );
}
