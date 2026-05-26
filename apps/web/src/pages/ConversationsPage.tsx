import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { MessageSquare, Clock, UsersRound, UserCircle, Inbox, Bot, Headset, Search, SquarePen } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { PageTransition, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useDebouncedConversationUpdated } from "@/hooks/useDebouncedConversationUpdated";
import { formatCurrencyUnits } from "@/lib/currency";
import { ContactQuickMessageModal } from "@/components/ContactQuickMessageModal";
import { ConversationsStartChatModal } from "@/components/ConversationsStartChatModal";
import {
  ConversationContextMenu,
  type ConversationContextTarget,
} from "@/components/ConversationContextMenu";
import { ConversationPriorityBadge } from "@/components/ConversationPriorityBadge";
import { ConversationListAvatar } from "@/components/ConversationListAvatar";
import { isConversationPriority, priorityListCardClass, type ConversationPriority } from "@/lib/conversationPriority";
interface Conversation {
  id: string;
  status: string;
  priority?: ConversationPriority | null;
  isUnread?: boolean;
  updatedAt: string;
  agentBotTriageActive?: boolean;
  awaitingHumanHandoff?: boolean;
  closureValue?: number | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    profilePictureUrl?: string | null;
    hasAvatar?: boolean;
    thumbnail?: string | null;
    assignedTo?: { id: string; name: string } | null;
    createdBy?: { id: string; name: string } | null;
  };
  assignedTo: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  inbox?: { id: string; name: string; isDefault: boolean; channelType?: string } | null;
  leadType: { id: string; name: string; color: string } | null;
  messages: { body: string | null; direction: string; createdAt: string }[];
}

const statusColors: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700 dark:bg-emerald-950/55 dark:text-emerald-200",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-200",
  RESOLVED: "bg-gray-100 text-gray-600 dark:bg-ink-800 dark:text-ink-300",
};

export function ConversationsPage() {
  const { t, dateLocale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [listSearch, setListSearch] = useState(() => searchParams.get("q") ?? "");
  const [composeOpen, setComposeOpen] = useState(false);
  const [quickContact, setQuickContact] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>(() => searchParams.get("teamId") ?? "");
  const [inboxFilter, setInboxFilter] = useState<string>(() => searchParams.get("inboxId") ?? "");
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [inboxOptions, setInboxOptions] = useState<{ id: string; name: string }[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    target: ConversationContextTarget;
    position: { x: number; y: number };
  } | null>(null);
  const hasAnimated = useRef(false);

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  const mineActive =
    searchParams.get("mine") === "1" || searchParams.get("mine") === "true";

  const botAttendanceActive =
    searchParams.get("bot") === "1" || searchParams.get("botAttendance") === "1";

  const attendanceScopeActive = searchParams.get("attendance") === "1";

  const [orgAgentBotTriageActive, setOrgAgentBotTriageActive] = useState(false);
  const [orgAttendanceTabEnabled, setOrgAttendanceTabEnabled] = useState(false);

  type ConversationListScope = "org" | "mine" | "bot" | "attendance";

  const setScopeParam = useCallback((scope: ConversationListScope) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("mine");
        n.delete("bot");
        n.delete("botAttendance");
        n.delete("attendance");
        if (scope === "mine") {
          n.set("mine", "1");
        } else if (scope === "bot") {
          n.set("bot", "1");
          n.delete("status");
        } else if (scope === "attendance") {
          n.set("attendance", "1");
          n.delete("status");
        }
        return n;
      },
      { replace: true },
    );
    if (scope === "bot" || scope === "attendance") {
      setStatusFilter("");
    }
  }, [setSearchParams]);

  useEffect(() => {
    const s = searchParams.get("status");
    if (s === "OPEN" || s === "PENDING" || s === "RESOLVED") {
      setStatusFilter(s);
    } else {
      setStatusFilter("");
    }
    const tid = searchParams.get("teamId") ?? "";
    setTeamFilter(tid);
    const iid = searchParams.get("inboxId") ?? "";
    setInboxFilter(iid);
  }, [searchParams]);

  const setTeamFilterUrl = (teamId: string) => {
    setTeamFilter(teamId);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (teamId) n.set("teamId", teamId);
        else n.delete("teamId");
        return n;
      },
      { replace: true },
    );
  };

  const setInboxFilterUrl = (inboxId: string) => {
    setInboxFilter(inboxId);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (inboxId) n.set("inboxId", inboxId);
        else n.delete("inboxId");
        return n;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    async function loadTeams() {
      try {
        const res = await api.get<{ data: { id: string; name: string }[] }>("/teams");
        setTeamOptions(res.data.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        setTeamOptions([]);
      }
    }
    void loadTeams();
  }, []);

  useEffect(() => {
    async function loadInboxes() {
      try {
        const res = await api.get<{ data: { id: string; name: string }[] }>("/inboxes");
        setInboxOptions(res.data.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        setInboxOptions([]);
      }
    }
    void loadInboxes();
  }, []);

  useEffect(() => {
    async function loadChannelSettings() {
      try {
        const res = await api.get<{
          agentBotTriageActive?: boolean;
          conversationsAttendanceTabEnabled?: boolean;
        }>("/settings/channel");
        setOrgAgentBotTriageActive(res.agentBotTriageActive === true);
        setOrgAttendanceTabEnabled(res.conversationsAttendanceTabEnabled === true);
      } catch {
        setOrgAgentBotTriageActive(false);
        setOrgAttendanceTabEnabled(false);
      }
    }
    void loadChannelSettings();
  }, []);

  useEffect(() => {
    if (botAttendanceActive && !orgAgentBotTriageActive) {
      setScopeParam("org");
    }
  }, [botAttendanceActive, orgAgentBotTriageActive, setScopeParam]);

  useEffect(() => {
    if (attendanceScopeActive && !orgAttendanceTabEnabled) {
      setScopeParam("org");
    }
  }, [attendanceScopeActive, orgAttendanceTabEnabled, setScopeParam]);

  const loadConversations = useCallback(async () => {
    if (!hasAnimated.current) setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (botAttendanceActive) {
        params.set("botAttendance", "1");
      } else if (attendanceScopeActive) {
        params.set("waitingAttendance", "1");
      } else {
        if (statusFilter) params.set("status", statusFilter);
        if (mineActive) params.set("mine", "1");
      }
      if (teamFilter) params.set("teamId", teamFilter);
      if (inboxFilter) params.set("inboxId", inboxFilter);
      const res = await api.get<{ data: Conversation[] }>(`/conversations?${params}`);
      setConversations(res.data);
      const contactIds = res.data.map((c) => c.contact.id).slice(0, 40);
      if (contactIds.length > 0) {
        void api.post("/contacts/sync-avatars", { contactIds }).catch(() => {});
      }
      try {
        localStorage.setItem(
          "openconduit_conversation_list_ids",
          JSON.stringify(res.data.map((c) => c.id)),
        );
      } catch {
      }
    } catch {
      /* failed */
    } finally {
      hasAnimated.current = true;
      setLoading(false);
    }
  }, [statusFilter, teamFilter, inboxFilter, mineActive, botAttendanceActive, attendanceScopeActive]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useDebouncedConversationUpdated(() => {
    void loadConversations();
  });

  const digitsOnly = (s: string) => s.replace(/\D/g, "");
  const filteredConversations = useMemo(() => {
    const raw = listSearch.trim().toLowerCase();
    if (!raw) return conversations;
    const dRaw = digitsOnly(raw);
    return conversations.filter((c) => {
      const name = c.contact.name.toLowerCase();
      const phone = c.contact.phone ?? "";
      const phoneDigits = digitsOnly(phone);
      const last = (c.messages?.[0]?.body ?? "").toLowerCase();
      if (name.includes(raw)) return true;
      if (dRaw && phoneDigits.includes(dRaw)) return true;
      if (phone.toLowerCase().includes(raw)) return true;
      if (last.includes(raw)) return true;
      return false;
    });
  }, [conversations, listSearch]);

  const statusLabel = (s: string) => {
    if (s === "OPEN") return t("conversationDetail.statusOpen");
    if (s === "PENDING") return t("conversationDetail.statusPending");
    if (s === "RESOLVED") return t("conversationDetail.statusResolved");
    return s;
  };

  const counts = useMemo(() => {
    const c = { all: 0, open: 0, pending: 0, resolved: 0 };
    c.all = conversations.length;
    for (const row of conversations) {
      if (row.status === "OPEN") c.open += 1;
      else if (row.status === "PENDING") c.pending += 1;
      else if (row.status === "RESOLVED") c.resolved += 1;
    }
    return c;
  }, [conversations]);

  const filters: { key: string; label: string }[] = [
    { key: "", label: t("common.all") },
    { key: "OPEN", label: t("conversations.filterOpen") },
    { key: "PENDING", label: t("conversations.filterPending") },
    { key: "RESOLVED", label: t("conversations.filterResolved") },
  ];

  return (
    <PageTransition>
      <div className="relative h-full min-h-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,122,89,0.08)_0%,_transparent_55%)] dark:bg-[radial-gradient(ellipse_80%_45%_at_50%_0%,rgba(124,152,182,0.16),transparent_60%)]" />
        <div className="relative flex h-full min-h-0 w-full flex-col gap-4 p-4 sm:p-6 lg:p-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{t("conversations.title")}</h1>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("conversations.subtitle")}</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[340px] sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 dark:text-ink-500" />
                <input
                  type="search"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder={t("conversations.searchListPlaceholder")}
                  className="input-field h-11 pl-10"
                  aria-label={t("conversations.searchListPlaceholder")}
                />
              </div>
              <button
                type="button"
                onClick={() => setComposeOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 dark:border-ink-700 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:border-brand-500/40 dark:hover:bg-ink-900"
                title={t("conversations.newMessageTooltip")}
                aria-label={t("conversations.newMessageTooltip")}
              >
                <SquarePen className="h-5 w-5" />
              </button>
            </div>
          </header>

          <section className="card-surface flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-white/70 px-4 py-3 backdrop-blur-sm dark:border-ink-800 dark:bg-ink-950/25">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScopeParam("org")}
                  className={clsx(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    !mineActive && !botAttendanceActive && !attendanceScopeActive
                      ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("conversations.scopeOrg")}
                  {!botAttendanceActive && !mineActive && !attendanceScopeActive ? (
                    <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">{counts.all}</span>
                  ) : null}
                </button>
                {orgAttendanceTabEnabled ? (
                  <button
                    type="button"
                    onClick={() => setScopeParam("attendance")}
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      attendanceScopeActive
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                    )}
                  >
                    <Headset className="h-3.5 w-3.5" />
                    {t("conversations.scopeAttendance")}
                    {attendanceScopeActive ? (
                      <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">{counts.all}</span>
                    ) : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setScopeParam("mine")}
                  className={clsx(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    mineActive
                      ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                  )}
                >
                  <UserCircle className="h-3.5 w-3.5" />
                  {t("conversations.myAssignments")}
                </button>
                {orgAgentBotTriageActive ? (
                  <button
                    type="button"
                    onClick={() => setScopeParam("bot")}
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      botAttendanceActive
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                    )}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {t("conversations.scopeBotAttendance")}
                    {botAttendanceActive ? (
                      <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">{counts.all}</span>
                    ) : null}
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!botAttendanceActive && !attendanceScopeActive ? (
                <div className="flex flex-wrap gap-1 rounded-full bg-ink-100 p-1 dark:bg-ink-900/60">
                  {filters.map((f) => (
                    <button
                      key={f.key || "all"}
                      type="button"
                      onClick={() => setStatusFilter(f.key)}
                      className={clsx(
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                        statusFilter === f.key
                          ? "bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-ink-50"
                          : "text-ink-600 hover:bg-ink-200/70 dark:text-ink-300 dark:hover:bg-ink-900",
                      )}
                    >
                      {f.label}
                      {f.key === "OPEN" ? (
                        <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-200">
                          {counts.open}
                        </span>
                      ) : f.key === "PENDING" ? (
                        <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                          {counts.pending}
                        </span>
                      ) : f.key === "RESOLVED" ? (
                        <span className="ml-2 rounded-full bg-ink-300/30 px-1.5 py-0.5 text-[10px] font-bold text-ink-700 dark:bg-ink-700/50 dark:text-ink-200">
                          {counts.resolved}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                ) : null}

                <div className="hidden items-center gap-2 md:flex">
                  <UsersRound className="h-4 w-4 shrink-0 text-ink-400 dark:text-ink-500" />
                  <label htmlFor="conv-team-filter" className="sr-only">
                    {t("conversations.filterTeam")}
                  </label>
                  <select
                    id="conv-team-filter"
                    value={teamFilter}
                    onChange={(e) => setTeamFilterUrl(e.target.value)}
                    className="h-10 rounded-xl border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-800 dark:border-ink-700 dark:bg-ink-950/20 dark:text-ink-100"
                  >
                    <option value="">{t("conversations.allTeams")}</option>
                    {teamOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  <Inbox className="h-4 w-4 shrink-0 text-ink-400 dark:text-ink-500" />
                  <label htmlFor="conv-inbox-filter" className="sr-only">
                    {t("conversations.filterInbox")}
                  </label>
                  <select
                    id="conv-inbox-filter"
                    value={inboxFilter}
                    onChange={(e) => setInboxFilterUrl(e.target.value)}
                    className="h-10 rounded-xl border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-800 dark:border-ink-700 dark:bg-ink-950/20 dark:text-ink-100"
                  >
                    <option value="">{t("conversations.allInboxes")}</option>
                    {inboxOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <motion.div
                  className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white/70 py-16 backdrop-blur-sm dark:border-ink-700 dark:bg-ink-950/20"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.22 }}
                >
                  <MessageSquare className="mb-3 h-12 w-12 text-ink-300 dark:text-ink-600" />
                  <p className="text-sm text-ink-600 dark:text-ink-400">
                    {listSearch.trim() && conversations.length > 0
                      ? t("conversations.emptySearchTitle")
                      : botAttendanceActive
                        ? t("conversations.emptyBotTitle")
                        : attendanceScopeActive
                          ? t("conversations.emptyAttendanceTitle")
                          : mineActive
                            ? t("conversations.emptyMineTitle")
                            : t("conversations.emptyTitle")}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-500">
                    {listSearch.trim() && conversations.length > 0
                      ? t("conversations.emptySearchHint")
                      : botAttendanceActive
                        ? t("conversations.emptyBotHint")
                        : attendanceScopeActive
                          ? t("conversations.emptyAttendanceHint")
                          : mineActive
                            ? t("conversations.emptyMineHint")
                            : t("conversations.emptyHint")}
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-2">
                  {filteredConversations.map((conv) => {
                    const lastMessage = conv.messages?.[0];
                    return (
                      <div
                        key={conv.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            target: {
                              id: conv.id,
                              status: conv.status,
                              priority: conv.priority ?? null,
                              contact: { id: conv.contact.id, name: conv.contact.name },
                            },
                            position: { x: e.clientX, y: e.clientY },
                          });
                        }}
                      >
                        <Link
                          to={`/conversations/${conv.id}`}
                          className={clsx(
                            "group flex items-center gap-4 rounded-2xl border p-4 transition-all",
                            "border-ink-200 bg-white/80 shadow-sm hover:-translate-y-0.5 hover:shadow-md",
                            "dark:border-ink-800 dark:bg-ink-950/20 dark:shadow-none dark:hover:border-ink-700 dark:hover:bg-ink-900/30",
                            priorityListCardClass(conv.priority),
                            conv.priority === "URGENT" && "dark:hover:border-red-500/80",
                            conv.isUnread &&
                              "border-brand-300/80 bg-brand-50/40 ring-1 ring-brand-400/25 dark:border-brand-500/40 dark:bg-brand-950/25 dark:ring-brand-400/20",
                          )}
                        >
                          <ConversationListAvatar
                            contactId={conv.contact.id}
                            contactName={conv.contact.name}
                            profilePictureUrl={conv.contact.profilePictureUrl}
                            hasAvatar={conv.contact.hasAvatar}
                            thumbnail={conv.contact.thumbnail}
                            channelType={conv.inbox?.channelType}
                            priority={conv.priority}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {conv.isUnread ? (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-brand-500 ring-2 ring-brand-200 dark:ring-brand-900/50"
                                  title={t("conversations.unreadBadge")}
                                  aria-hidden
                                />
                              ) : null}
                              <span
                                className={clsx(
                                  "truncate text-ink-900 dark:text-ink-50",
                                  conv.isUnread ? "font-bold" : "font-semibold",
                                )}
                              >
                                {conv.contact.name}
                              </span>
                              {isConversationPriority(conv.priority) ? (
                                <ConversationPriorityBadge priority={conv.priority} />
                              ) : null}
                              <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusColors[conv.status])}>
                                {statusLabel(conv.status)}
                              </span>
                              {conv.inbox ? (
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-950/35 dark:text-violet-200">
                                  {conv.inbox.name}
                                </span>
                              ) : null}
                              {conv.awaitingHumanHandoff ? (
                                <span
                                  className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-900 dark:bg-red-950/45 dark:text-red-100"
                                  title={t("conversationDetail.awaitingHumanBanner")}
                                >
                                  {t("conversationDetail.awaitingHumanBadge")}
                                </span>
                              ) : null}
                              {conv.agentBotTriageActive && !conv.awaitingHumanHandoff && (conv.status === "OPEN" || conv.status === "PENDING") ? (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-950/35 dark:text-violet-200"
                                  title={t("conversationDetail.botTriageBanner")}
                                >
                                  <Bot className="h-3.5 w-3.5" />
                                  {typeof conv.assignedTo?.id === "string" && conv.assignedTo.id.length > 0
                                    ? t("conversationDetail.transferToBot")
                                    : t("conversationDetail.botInAttendance")}
                                </span>
                              ) : null}
                              {conv.status === "RESOLVED" && conv.leadType ? (
                                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: conv.leadType.color }}>
                                  {conv.leadType.name}
                                </span>
                              ) : null}
                              {conv.status === "RESOLVED" && conv.closureValue != null && conv.closureValue > 0 ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200">
                                  {fmtMoney(conv.closureValue)}
                                </span>
                              ) : null}
                            </div>
                            <p
                              className={clsx(
                                "mt-1 line-clamp-1 text-sm",
                                conv.isUnread
                                  ? "font-medium text-ink-800 dark:text-ink-200"
                                  : "text-ink-600 dark:text-ink-400",
                              )}
                            >
                              {lastMessage?.body || t("conversations.noMessages")}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink-500 dark:text-ink-500">
                            <Clock className="h-3.5 w-3.5" />
                            {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: true, locale: dateLocale })}
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <ConversationsStartChatModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onPickContact={(c) => {
          setQuickContact(c);
          setComposeOpen(false);
        }}
      />
      <ContactQuickMessageModal
        open={!!quickContact}
        contact={quickContact}
        onClose={() => {
          setQuickContact(null);
          void loadConversations();
        }}
      />
      <ConversationContextMenu
        target={contextMenu?.target ?? null}
        position={contextMenu?.position ?? null}
        onClose={() => setContextMenu(null)}
        onUpdated={() => void loadConversations()}
        onDeleted={(conversationId) => {
          setConversations((prev) => prev.filter((c) => c.id !== conversationId));
          setContextMenu(null);
        }}
      />
    </PageTransition>
  );
}
