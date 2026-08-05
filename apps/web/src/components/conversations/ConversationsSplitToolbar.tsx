import clsx from "clsx";
import type { ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  Clock,
  Headset,
  Inbox,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Tag,
  Target,
  UserCircle,
  UsersRound,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type ScopeCounts = {
  org: number;
  bot: number;
  attendanceActive: number;
  attendanceQueue: number;
  mine: number;
};

type StatusCounts = {
  open: number;
  pending: number;
  resolved: number;
};

type FilterOption = { key: string; label: string };

type Props = {
  listSearch: string;
  onListSearchChange: (value: string) => void;
  onCompose: () => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  leadTypeFilter: string;
  onLeadTypeFilterChange: (value: string) => void;
  tagOptions: { id: string; name: string }[];
  leadTypeOptions: { id: string; name: string }[];
  orgAttendanceTabEnabled: boolean;
  orgAgentBotTriageActive: boolean;
  attendanceScopeActive: boolean;
  mineActive: boolean;
  botAttendanceActive: boolean;
  scopeCounts: ScopeCounts;
  statusCounts: StatusCounts;
  statusFilter: string;
  onStatusFilterChange: (key: string) => void;
  statusFilters: FilterOption[];
  teamFilter: string;
  onTeamFilterChange: (value: string) => void;
  inboxFilter: string;
  onInboxFilterChange: (value: string) => void;
  teamOptions: { id: string; name: string }[];
  inboxOptions: { id: string; name: string }[];
  onScopeChange: (scope: "org" | "mine" | "bot" | "attendance") => void;
  onAttendanceSubView: (sub: "queue" | "mine") => void;
};

const compactSelectClass =
  "h-7 min-w-0 max-w-[7.5rem] flex-1 appearance-none truncate rounded-md border border-ink-200/70 bg-white py-0 pl-6 pr-5 text-[11px] font-medium text-ink-700 shadow-none transition hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-ink-700/60 dark:bg-ink-950/30 dark:text-ink-100 dark:hover:border-ink-600";

function ScopeChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  animateIcon,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Tag;
  label: string;
  count: number;
  animateIcon?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      onClick={onClick}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
        active
          ? "border-ink-300/80 bg-white text-ink-900 shadow-sm dark:border-ink-600 dark:bg-ink-900/80 dark:text-ink-50"
          : "border-transparent bg-transparent text-ink-500 hover:border-ink-200/80 hover:bg-white/80 hover:text-ink-700 dark:text-ink-400 dark:hover:border-ink-700/60 dark:hover:bg-ink-900/40 dark:hover:text-ink-200",
      )}
    >
      <Icon
        className={clsx("h-3 w-3 shrink-0", active && animateIcon && "animate-bot-head-nod")}
        strokeWidth={2}
        aria-hidden
      />
      <span className="max-w-[4.5rem] truncate">{label}</span>
      <span
        className={clsx(
          "min-w-[1rem] text-center text-[10px] font-semibold tabular-nums leading-none",
          active ? "text-ink-600 dark:text-ink-300" : "text-ink-400 dark:text-ink-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function CompactSelect({
  id,
  icon: Icon,
  value,
  onChange,
  children,
  ariaLabel,
}: {
  id: string;
  icon: typeof Tag;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <div className="relative min-w-0 shrink-0">
      <Icon
        className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400 dark:text-ink-500"
        aria-hidden
      />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={compactSelectClass}
        aria-label={ariaLabel}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400 dark:text-ink-500"
        aria-hidden
      />
    </div>
  );
}

export function ConversationsSplitToolbar(props: Props) {
  const { t } = useI18n();
  const {
    listSearch,
    onListSearchChange,
    onCompose,
    tagFilter,
    onTagFilterChange,
    leadTypeFilter,
    onLeadTypeFilterChange,
    tagOptions,
    leadTypeOptions,
    orgAttendanceTabEnabled,
    orgAgentBotTriageActive,
    attendanceScopeActive,
    mineActive,
    botAttendanceActive,
    scopeCounts,
    statusCounts,
    statusFilter,
    onStatusFilterChange,
    statusFilters,
    teamFilter,
    onTeamFilterChange,
    inboxFilter,
    onInboxFilterChange,
    teamOptions,
    inboxOptions,
    onScopeChange,
    onAttendanceSubView,
  } = props;

  const orgScopeActive = !mineActive && !botAttendanceActive && !attendanceScopeActive;
  const statusAllCount = statusCounts.open + statusCounts.pending + statusCounts.resolved;
  const showStatusRow = !botAttendanceActive && (!attendanceScopeActive || mineActive);

  const statusCountFor = (key: string): number | null => {
    if (key === "OPEN") return statusCounts.open;
    if (key === "PENDING") return statusCounts.pending;
    if (key === "RESOLVED") return statusCounts.resolved;
    if (key === "") return statusAllCount;
    return null;
  };

  return (
    <div className="shrink-0 space-y-2 border-b border-ink-200/50 bg-[#fafbfc] px-2.5 py-2 dark:border-ink-800/60 dark:bg-[#0c1219]">
      {/* Filtros — uma linha */}
      <div className="flex flex-nowrap items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative min-w-[5.5rem] max-w-[8rem] shrink-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400"
            aria-hidden
          />
          <input
            type="search"
            value={listSearch}
            onChange={(e) => onListSearchChange(e.target.value)}
            placeholder={t("conversations.searchListPlaceholder")}
            className="h-7 w-full rounded-md border border-ink-200/70 bg-white pl-7 pr-2 text-[11px] text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-ink-700/60 dark:bg-ink-950/30 dark:text-ink-50"
            aria-label={t("conversations.searchListPlaceholder")}
          />
        </div>
        <CompactSelect
          id="conv-tag-filter-split"
          icon={Tag}
          value={tagFilter}
          onChange={onTagFilterChange}
          ariaLabel={t("conversations.filterTag")}
        >
          <option value="">{t("conversations.allTags")}</option>
          {tagOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect
          id="conv-lead-type-filter-split"
          icon={Target}
          value={leadTypeFilter}
          onChange={onLeadTypeFilterChange}
          ariaLabel={t("conversations.filterLeadType")}
        >
          <option value="">{t("conversations.allLeadTypes")}</option>
          {leadTypeOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect
          id="conv-team-filter-split"
          icon={UsersRound}
          value={teamFilter}
          onChange={onTeamFilterChange}
          ariaLabel={t("conversations.filterTeam")}
        >
          <option value="">{t("conversations.allTeams")}</option>
          {teamOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect
          id="conv-inbox-filter-split"
          icon={Inbox}
          value={inboxFilter}
          onChange={onInboxFilterChange}
          ariaLabel={t("conversations.filterInbox")}
        >
          <option value="">{t("conversations.allInboxes")}</option>
          {inboxOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </CompactSelect>
        <button
          type="button"
          onClick={onCompose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-500 text-white shadow-sm transition hover:bg-brand-600 active:scale-[0.98]"
          title={t("conversations.newMessageTooltip")}
          aria-label={t("conversations.newMessageTooltip")}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>

      {/* Scope chips — Linear style */}
      <div
        className="flex flex-nowrap items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={t("conversations.title")}
      >
        {orgAttendanceTabEnabled ? (
          <ScopeChip
            active={attendanceScopeActive}
            onClick={() => onScopeChange("attendance")}
            icon={Headset}
            label={t("conversations.scopeAttendance")}
            count={scopeCounts.attendanceActive}
          />
        ) : null}
        <ScopeChip
          active={orgScopeActive}
          onClick={() => onScopeChange("org")}
          icon={MessageSquare}
          label={t("conversations.scopeOrgShort")}
          count={scopeCounts.org}
        />
        {!orgAttendanceTabEnabled ? (
          <ScopeChip
            active={mineActive}
            onClick={() => onScopeChange("mine")}
            icon={UserCircle}
            label={t("conversations.myAssignmentsShort")}
            count={scopeCounts.mine}
          />
        ) : null}
        {orgAgentBotTriageActive ? (
          <ScopeChip
            active={botAttendanceActive}
            onClick={() => onScopeChange("bot")}
            icon={Bot}
            label={t("conversations.scopeBotShort")}
            count={scopeCounts.bot}
            animateIcon={botAttendanceActive}
          />
        ) : null}
        {orgAttendanceTabEnabled && attendanceScopeActive ? (
          <>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-ink-200 dark:bg-ink-700" aria-hidden />
            <ScopeChip
              active={!mineActive}
              onClick={() => onAttendanceSubView("queue")}
              icon={Clock}
              label={t("conversations.attendanceQueueShort")}
              count={scopeCounts.attendanceQueue}
            />
            <ScopeChip
              active={mineActive}
              onClick={() => onAttendanceSubView("mine")}
              icon={UserCircle}
              label={t("conversations.myAssignmentsShort")}
              count={scopeCounts.mine}
            />
          </>
        ) : null}
        {showStatusRow ? (
          <>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-ink-200 dark:bg-ink-700" aria-hidden />
            {statusFilters.map((f) => {
              const count = statusCountFor(f.key);
              const active = statusFilter === f.key;
              return (
                <button
                  key={f.key || "all"}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onStatusFilterChange(f.key)}
                  title={f.label}
                  className={clsx(
                    "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition",
                    active
                      ? "bg-ink-100 text-ink-800 dark:bg-ink-800/80 dark:text-ink-100"
                      : "text-ink-500 hover:bg-ink-50 hover:text-ink-700 dark:text-ink-400 dark:hover:bg-ink-900/40",
                  )}
                >
                  <span className="max-w-[4rem] truncate">{f.label}</span>
                  {count != null ? (
                    <span className="text-[10px] font-semibold tabular-nums text-ink-400">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </>
        ) : null}
      </div>
    </div>
  );
}
