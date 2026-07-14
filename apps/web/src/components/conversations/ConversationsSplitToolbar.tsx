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

const splitSelectClass =
  "h-7 w-full min-w-0 appearance-none rounded-md border border-ink-200/90 bg-white py-0 pl-7 pr-6 text-[11px] font-medium text-ink-800 shadow-sm dark:border-ink-700/80 dark:bg-ink-950/40 dark:text-ink-100";

function SplitScopeCount({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={clsx(
        "min-w-[1.1rem] text-center text-[10px] font-bold tabular-nums leading-none",
        active ? "text-brand-600 dark:text-brand-300" : "text-ink-500 dark:text-ink-400",
      )}
    >
      {count}
    </span>
  );
}

function SplitSelect({
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
    <div className="relative min-w-0 flex-1">
      <Icon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400 dark:text-ink-500" aria-hidden />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={splitSelectClass}
        aria-label={ariaLabel}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400 dark:text-ink-500"
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

  const scopeTabClass = (active: boolean) =>
    clsx(
      "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 border-b-2 px-0.5 py-1 transition-colors",
      active
        ? "border-brand-500 text-brand-600 dark:border-brand-400 dark:text-brand-300"
        : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200",
    );

  const statusTabClass = (active: boolean) =>
    clsx(
      "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors",
      active
        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
        : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800/60",
    );

  const statusCountFor = (key: string): number | null => {
    if (key === "OPEN") return statusCounts.open;
    if (key === "PENDING") return statusCounts.pending;
    if (key === "RESOLVED") return statusCounts.resolved;
    if (key === "") return statusAllCount;
    return null;
  };

  return (
    <div className="shrink-0 space-y-1 border-b border-ink-200/70 bg-white/95 px-2 py-1.5 backdrop-blur-md dark:border-ink-800/80 dark:bg-ink-950/50">
      {/* Pesquisa + nova conversa */}
      <div className="flex flex-nowrap items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400 dark:text-ink-500"
            aria-hidden
          />
          <input
            type="search"
            value={listSearch}
            onChange={(e) => onListSearchChange(e.target.value)}
            placeholder={t("conversations.searchListPlaceholder")}
            className="h-8 w-full rounded-lg border border-ink-200/90 bg-white pl-8 pr-2 text-xs text-ink-900 shadow-sm placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700/80 dark:bg-ink-950/40 dark:text-ink-50 dark:placeholder:text-ink-500"
            aria-label={t("conversations.searchListPlaceholder")}
          />
        </div>
        <button
          type="button"
          onClick={onCompose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white shadow-md shadow-brand-500/25 transition hover:bg-brand-600 active:scale-[0.98] dark:bg-brand-600 dark:hover:bg-brand-500"
          title={t("conversations.newMessageTooltip")}
          aria-label={t("conversations.newMessageTooltip")}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>

      {/* Etiquetas + leads */}
      <div className="flex flex-nowrap items-center gap-1.5">
        <SplitSelect
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
        </SplitSelect>
        <SplitSelect
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
        </SplitSelect>
      </div>

      {/* Âmbito: atendimento · todas · bot */}
      <div
        className="flex flex-nowrap items-stretch divide-x divide-ink-200/80 dark:divide-ink-800/80"
        role="tablist"
        aria-label={t("conversations.title")}
      >
        {orgAttendanceTabEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={attendanceScopeActive}
            title={t("conversations.scopeAttendance")}
            onClick={() => onScopeChange("attendance")}
            className={scopeTabClass(attendanceScopeActive)}
          >
            <Headset className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <SplitScopeCount count={scopeCounts.attendanceActive} active={attendanceScopeActive} />
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={orgScopeActive}
          title={t("conversations.scopeOrg")}
          onClick={() => onScopeChange("org")}
          className={scopeTabClass(orgScopeActive)}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <SplitScopeCount count={scopeCounts.org} active={orgScopeActive} />
        </button>
        {!orgAttendanceTabEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={mineActive}
            title={t("conversations.myAssignments")}
            onClick={() => onScopeChange("mine")}
            className={scopeTabClass(mineActive)}
          >
            <UserCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <SplitScopeCount count={scopeCounts.mine} active={mineActive} />
          </button>
        ) : null}
        {orgAgentBotTriageActive ? (
          <button
            type="button"
            role="tab"
            aria-selected={botAttendanceActive}
            title={t("conversations.scopeBotAttendance")}
            onClick={() => onScopeChange("bot")}
            className={scopeTabClass(botAttendanceActive)}
          >
            <Bot className={clsx("h-3.5 w-3.5 shrink-0", botAttendanceActive && "animate-bot-head-nod")} strokeWidth={2} />
            <SplitScopeCount count={scopeCounts.bot} active={botAttendanceActive} />
          </button>
        ) : null}
      </div>

      {/* Sub-aba atendimento: fila / meus */}
      {orgAttendanceTabEnabled && attendanceScopeActive ? (
        <div className="flex flex-nowrap items-center gap-1">
          <button
            type="button"
            onClick={() => onAttendanceSubView("queue")}
            className={statusTabClass(!mineActive)}
            title={t("conversations.attendanceQueue")}
          >
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">{t("conversations.attendanceQueue")}</span>
            <span className="tabular-nums opacity-90">{scopeCounts.attendanceQueue}</span>
          </button>
          <button
            type="button"
            onClick={() => onAttendanceSubView("mine")}
            className={statusTabClass(mineActive)}
            title={t("conversations.myAssignments")}
          >
            <UserCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{t("conversations.myAssignments")}</span>
            <span className="tabular-nums opacity-90">{scopeCounts.mine}</span>
          </button>
        </div>
      ) : null}

      {/* Estado: todas · abertas · pendentes · finalizadas */}
      {showStatusRow ? (
        <div className="flex flex-nowrap items-center gap-0.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {statusFilters.map((f) => {
            const count = statusCountFor(f.key);
            const active = statusFilter === f.key;
            return (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => onStatusFilterChange(f.key)}
                className={statusTabClass(active)}
                title={f.label}
              >
                <span className="max-w-[5.5rem] truncate">{f.label}</span>
                {count != null ? (
                  <span
                    className={clsx(
                      "rounded px-1 py-px text-[10px] font-bold tabular-nums leading-none",
                      active ? "bg-white/20" : "bg-ink-200/70 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Time + caixa */}
      <div className="flex flex-nowrap items-center gap-1.5">
        <SplitSelect
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
        </SplitSelect>
        <SplitSelect
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
        </SplitSelect>
      </div>
    </div>
  );
}
