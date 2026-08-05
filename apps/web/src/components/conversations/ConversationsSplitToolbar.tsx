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
        active ? "text-brand-600 dark:text-brand-300" : "text-ink-400 dark:text-ink-500",
      )}
    >
      {count}
    </span>
  );
}

function scopeIconClass(active: boolean): string {
  return clsx(
    "h-4 w-4 shrink-0 transition-colors",
    active ? "text-brand-600 dark:text-brand-400" : "text-ink-400 dark:text-ink-500",
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

  const scopeTabButtonClass = (active: boolean) =>
    clsx(
      "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
      active
        ? "bg-white text-brand-600 dark:bg-ink-900/60 dark:text-brand-300"
        : "bg-transparent text-ink-500 hover:bg-white/60 dark:text-ink-400 dark:hover:bg-ink-900/30",
    );

  const statusCountBadgeClass = (active: boolean, key: string) => {
    if (active) {
      return "rounded-full bg-brand-100 px-1.5 py-px text-[10px] font-bold tabular-nums leading-none text-brand-700 dark:bg-brand-500/20 dark:text-brand-200";
    }
    if (key === "PENDING") {
      return "rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold tabular-nums leading-none text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
    }
    if (key === "OPEN") {
      return "rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-bold tabular-nums leading-none text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200";
    }
    return "text-[10px] font-bold tabular-nums leading-none text-ink-400 dark:text-ink-500";
  };

  const statusTabButtonClass = (active: boolean) =>
    clsx(
      "relative inline-flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
      active
        ? "text-brand-600 dark:text-brand-300"
        : "text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200",
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
        className="overflow-hidden rounded-lg border border-ink-200/90 bg-ink-50/50 dark:border-ink-700/80 dark:bg-ink-900/25"
        role="tablist"
        aria-label={t("conversations.title")}
      >
        <div className="flex flex-nowrap items-stretch">
        {orgAttendanceTabEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={attendanceScopeActive}
            title={t("conversations.scopeAttendance")}
            onClick={() => onScopeChange("attendance")}
            className={scopeTabButtonClass(attendanceScopeActive)}
          >
            <Headset className={scopeIconClass(attendanceScopeActive)} strokeWidth={2} />
            <SplitScopeCount count={scopeCounts.attendanceActive} active={attendanceScopeActive} />
            {attendanceScopeActive ? (
              <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-brand-500 dark:bg-brand-400" aria-hidden />
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={orgScopeActive}
          title={t("conversations.scopeOrg")}
          onClick={() => onScopeChange("org")}
          className={scopeTabButtonClass(orgScopeActive)}
        >
          <MessageSquare className={scopeIconClass(orgScopeActive)} strokeWidth={2} />
          <SplitScopeCount count={scopeCounts.org} active={orgScopeActive} />
          {orgScopeActive ? (
            <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-brand-500 dark:bg-brand-400" aria-hidden />
          ) : null}
        </button>
        {!orgAttendanceTabEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={mineActive}
            title={t("conversations.myAssignments")}
            onClick={() => onScopeChange("mine")}
            className={scopeTabButtonClass(mineActive)}
          >
            <UserCircle className={scopeIconClass(mineActive)} strokeWidth={2} />
            <SplitScopeCount count={scopeCounts.mine} active={mineActive} />
            {mineActive ? (
              <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-brand-500 dark:bg-brand-400" aria-hidden />
            ) : null}
          </button>
        ) : null}
        {orgAgentBotTriageActive ? (
          <button
            type="button"
            role="tab"
            aria-selected={botAttendanceActive}
            title={t("conversations.scopeBotAttendance")}
            onClick={() => onScopeChange("bot")}
            className={scopeTabButtonClass(botAttendanceActive)}
          >
            <Bot
              className={clsx(scopeIconClass(botAttendanceActive), botAttendanceActive && "animate-bot-head-nod")}
              strokeWidth={2}
            />
            <SplitScopeCount count={scopeCounts.bot} active={botAttendanceActive} />
            {botAttendanceActive ? (
              <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-brand-500 dark:bg-brand-400" aria-hidden />
            ) : null}
          </button>
        ) : null}
        </div>
      </div>

      {/* Sub-aba atendimento: fila / meus */}
      {orgAttendanceTabEnabled && attendanceScopeActive ? (
        <div
          className="flex flex-nowrap items-stretch border-b border-ink-200/80 dark:border-ink-700/80"
          role="tablist"
          aria-label={t("conversations.scopeAttendance")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={!mineActive}
            onClick={() => onAttendanceSubView("queue")}
            className={statusTabButtonClass(!mineActive)}
            title={t("conversations.attendanceQueue")}
          >
            <Clock className={clsx("h-3 w-3 shrink-0", !mineActive ? "text-brand-600" : "text-ink-400")} />
            <span className="truncate">{t("conversations.attendanceQueue")}</span>
            <span className={statusCountBadgeClass(!mineActive, "")}>{scopeCounts.attendanceQueue}</span>
            {!mineActive ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-500 dark:bg-brand-400" aria-hidden />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mineActive}
            onClick={() => onAttendanceSubView("mine")}
            className={statusTabButtonClass(mineActive)}
            title={t("conversations.myAssignments")}
          >
            <UserCircle className={clsx("h-3 w-3 shrink-0", mineActive ? "text-brand-600" : "text-ink-400")} />
            <span className="truncate">{t("conversations.myAssignments")}</span>
            <span className={statusCountBadgeClass(mineActive, "")}>{scopeCounts.mine}</span>
            {mineActive ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-500 dark:bg-brand-400" aria-hidden />
            ) : null}
          </button>
        </div>
      ) : null}

      {/* Estado: todas · abertas · pendentes · finalizadas */}
      {showStatusRow ? (
        <div
          className="flex flex-nowrap items-stretch gap-0 overflow-x-auto border-b border-ink-200/80 dark:border-ink-700/80 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label={t("conversations.filterStatus")}
        >
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
                className={statusTabButtonClass(active)}
                title={f.label}
              >
                <span className="max-w-[5.5rem] truncate">{f.label}</span>
                {count != null ? (
                  <span className={statusCountBadgeClass(active, f.key)}>{count}</span>
                ) : null}
                {active ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-500 dark:bg-brand-400" aria-hidden />
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
