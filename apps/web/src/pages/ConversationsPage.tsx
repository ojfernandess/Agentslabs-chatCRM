import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { MessageSquare, Clock, UsersRound, UserCircle, Inbox } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { PageTransition, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { formatCurrencyUnits } from "@/lib/currency";

interface Conversation {
  id: string;
  status: string;
  updatedAt: string;
  closureValue?: number | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    profilePictureUrl?: string | null;
    assignedTo?: { id: string; name: string } | null;
    createdBy?: { id: string; name: string } | null;
  };
  assignedTo: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  inbox?: { id: string; name: string; isDefault: boolean } | null;
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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>(() => searchParams.get("teamId") ?? "");
  const [inboxFilter, setInboxFilter] = useState<string>(() => searchParams.get("inboxId") ?? "");
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [inboxOptions, setInboxOptions] = useState<{ id: string; name: string }[]>([]);
  const hasAnimated = useRef(false);

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  const mineActive =
    searchParams.get("mine") === "1" || searchParams.get("mine") === "true";

  const setMineParam = (mine: boolean) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (mine) n.set("mine", "1");
        else n.delete("mine");
        return n;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    const s = searchParams.get("status");
    if (s === "OPEN" || s === "PENDING" || s === "RESOLVED") {
      setStatusFilter(s);
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
    async function load() {
      if (!hasAnimated.current) setLoading(true);
      try {
        const params = new URLSearchParams({ pageSize: "50" });
        if (statusFilter) params.set("status", statusFilter);
        if (teamFilter) params.set("teamId", teamFilter);
        if (inboxFilter) params.set("inboxId", inboxFilter);
        if (mineActive) params.set("mine", "1");
        const res = await api.get<{ data: Conversation[] }>(`/conversations?${params}`);
        setConversations(res.data);
      } catch {
        /* failed */
      } finally {
        hasAnimated.current = true;
        setLoading(false);
      }
    }
    load();
  }, [statusFilter, teamFilter, inboxFilter, mineActive]);

  const statusLabel = (s: string) => {
    if (s === "OPEN") return t("conversationDetail.statusOpen");
    if (s === "PENDING") return t("conversationDetail.statusPending");
    if (s === "RESOLVED") return t("conversationDetail.statusResolved");
    return s;
  };

  const filters: { key: string; label: string }[] = [
    { key: "", label: t("common.all") },
    { key: "OPEN", label: t("conversations.filterOpen") },
    { key: "PENDING", label: t("conversations.filterPending") },
    { key: "RESOLVED", label: t("conversations.filterResolved") },
  ];

  return (
    <PageTransition>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-ink-50">{t("conversations.title")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-ink-400">{t("conversations.subtitle")}</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMineParam(false)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              !mineActive
                ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700",
            )}
          >
            <MessageSquare className="h-4 w-4 opacity-90" />
            {t("conversations.scopeOrg")}
          </button>
          <button
            type="button"
            onClick={() => setMineParam(true)}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              mineActive
                ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700",
            )}
          >
            <UserCircle className="h-4 w-4 opacity-90" />
            {t("conversations.myAssignments")}
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  statusFilter === f.key
                    ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                    : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-2 sm:max-w-xs sm:ml-auto">
            <UsersRound className="h-4 w-4 shrink-0 text-gray-400 dark:text-ink-500" />
            <label htmlFor="conv-team-filter" className="sr-only">
              {t("conversations.filterTeam")}
            </label>
            <select
              id="conv-team-filter"
              value={teamFilter}
              onChange={(e) => setTeamFilterUrl(e.target.value)}
              className="min-w-[140px] flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
            >
              <option value="">{t("conversations.allTeams")}</option>
              {teamOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <Inbox className="h-4 w-4 shrink-0 text-gray-400 dark:text-ink-500" />
            <label htmlFor="conv-inbox-filter" className="sr-only">
              {t("conversations.filterInbox")}
            </label>
            <select
              id="conv-inbox-filter"
              value={inboxFilter}
              onChange={(e) => setInboxFilterUrl(e.target.value)}
              className="min-w-[140px] flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
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

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : conversations.length === 0 ? (
          <motion.div
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-16 dark:border-ink-600 dark:bg-[#161f2c]/80"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <MessageSquare className="mb-3 h-12 w-12 text-gray-300 dark:text-ink-600" />
            <p className="text-sm text-gray-500 dark:text-ink-400">
              {mineActive ? t("conversations.emptyMineTitle") : t("conversations.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-ink-500">
              {mineActive ? t("conversations.emptyMineHint") : t("conversations.emptyHint")}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conv) => {
              const lastMessage = conv.messages[0];
              return (
                <div key={conv.id}>
                  <Link
                    to={`/conversations/${conv.id}`}
                    className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-ink-700 dark:bg-[#161f2c] dark:shadow-none dark:hover:border-ink-600 dark:hover:bg-[#1a2532] dark:hover:shadow-lg dark:hover:shadow-black/20"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200 dark:ring-1 dark:ring-brand-500/20">
                      {conv.contact.profilePictureUrl ? (
                        <img
                          src={conv.contact.profilePictureUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        conv.contact.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-ink-50">{conv.contact.name}</span>
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            statusColors[conv.status],
                          )}
                        >
                          {statusLabel(conv.status)}
                        </span>
                        {conv.inbox ? (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950/45 dark:text-violet-200">
                            {conv.inbox.name}
                          </span>
                        ) : null}
                        {conv.status === "RESOLVED" && conv.leadType && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: conv.leadType.color }}
                          >
                            {conv.leadType.name}
                          </span>
                        )}
                        {conv.status === "RESOLVED" &&
                        conv.closureValue != null &&
                        conv.closureValue > 0 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                            {fmtMoney(conv.closureValue)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-ink-400">
                        {lastMessage?.body || t("conversations.noMessages")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-xs text-gray-400 dark:text-ink-500">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(conv.updatedAt), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
