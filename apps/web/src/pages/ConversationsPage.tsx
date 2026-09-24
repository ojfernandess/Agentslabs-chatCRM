import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { MessageSquare, Clock, UsersRound, UserCircle, Inbox, Bot, Headset, Search, MessageSquarePlus, Phone, Tag } from "lucide-react";
import clsx from "clsx";
import { PageTransition, motion, AnimatePresence } from "@/components/Motion";
import { HelpContextButton } from "@/components/help/HelpContextButton";
import { useI18n } from "@/i18n/I18nProvider";
import {
  useDebouncedConversationUpdated,
  type ConversationUpdatedDetail,
} from "@/hooks/useDebouncedConversationUpdated";
import {
  CONVERSATION_MESSAGE_CREATED_EVENT,
  type ConversationMessageCreatedDetail,
} from "@/lib/conversationMessagePush";
import {
  conversationMatchesListScope,
  mergeConversationScopeHint,
  type ConversationListScopeState,
} from "@/lib/conversationListScope";
import { useConversationAgentTypingMap } from "@/hooks/useConversationAgentTyping";
import { formatCurrencyUnits } from "@/lib/currency";
import { ContactQuickMessageModal } from "@/components/ContactQuickMessageModal";
import { TelephonyCallButton } from "@/components/telephony/TelephonyCallButton";
import { TelephonyDialModal, useTelephonyCanDial } from "@/components/telephony/TelephonyDialModal";
import { useAuth } from "@/hooks/useAuth";
import { ConversationsStartChatModal } from "@/components/ConversationsStartChatModal";
import {
  ConversationContextMenu,
  type ConversationContextTarget,
} from "@/components/ConversationContextMenu";
import { ConversationListItem } from "@/components/ConversationListItem";
import { ConversationsSplitToolbar } from "@/components/conversations/ConversationsSplitToolbar";
import type { ActiveVoiceCall } from "@/lib/activeVoiceCall";
import { formatMessageBodyForPreview } from "@/lib/messagePreviewText";
import type { ConversationPriority } from "@/lib/conversationPriority";
import {
  getCachedConversation,
  getInflightConversation,
  setCachedConversation,
  setInflightConversation,
} from "@/lib/conversationDetailCache";
function conversationLeadTypeId(conv: Conversation): string | null {
  return conv.leadType?.id ?? conv.contact.pipelineStage?.leadTypeId ?? null;
}

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
    pipelineStage?: { id: string; name: string; color: string; leadTypeId: string | null } | null;
    tags?: { tag: { id: string; name: string; color: string } }[];
  };
  assignedTo: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  inbox?: { id: string; name: string; isDefault: boolean; channelType?: string } | null;
  leadType: { id: string; name: string; color: string } | null;
  messages: { body: string | null; direction: string; createdAt: string; type?: string }[];
  activeVoiceCall?: ActiveVoiceCall | null;
}

function ScopeTabCount({ count, selected }: { count: number; selected: boolean }) {
  return (
    <span
      className={clsx(
        "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
        selected
          ? "bg-white/25"
          : "bg-ink-200/90 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
      )}
    >
      {count}
    </span>
  );
}

function applySyncedContactAvatars(rows: Conversation[], syncedIds: string[]): Conversation[] {
  if (syncedIds.length === 0) return rows;
  const synced = new Set(syncedIds);
  return rows.map((row) =>
    synced.has(row.contact.id)
      ? {
          ...row,
          contact: {
            ...row.contact,
            hasAvatar: true,
            thumbnail: `/api/v1/contacts/${row.contact.id}/profile-picture`,
          },
        }
      : row,
  );
}

const CONVERSATION_LIST_PAGE_SIZE = 50;

type ConversationListScopeCache = {
  rows: Conversation[];
  total: number;
  page: number;
};

function buildConversationListQuery(input: {
  organizationId?: string | null;
  botAttendanceActive: boolean;
  attendanceScopeActive: boolean;
  mineActive: boolean;
  statusFilter: string;
  teamFilter: string;
  inboxFilter: string;
  leadTypeFilter: string;
  page?: number;
}): { fetchKey: string; params: URLSearchParams } {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(CONVERSATION_LIST_PAGE_SIZE),
  });
  if (input.botAttendanceActive) {
    params.set("botAttendance", "1");
  } else if (input.attendanceScopeActive && input.mineActive) {
    if (input.statusFilter) params.set("status", input.statusFilter);
    params.set("mine", "1");
  } else if (input.attendanceScopeActive) {
    params.set("waitingAttendance", "1");
  } else {
    if (input.statusFilter) params.set("status", input.statusFilter);
    if (input.mineActive) params.set("mine", "1");
  }
  if (input.teamFilter) params.set("teamId", input.teamFilter);
  if (input.inboxFilter) params.set("inboxId", input.inboxFilter);
  if (input.leadTypeFilter) params.set("leadTypeId", input.leadTypeFilter);
  const fetchKey = `${input.organizationId ?? ""}|${params.toString()}`;
  return { fetchKey, params };
}

export function ConversationsPage({
  splitView = false,
  onRegisterRefresh,
}: {
  splitView?: boolean;
  onRegisterRefresh?: (refresh: () => Promise<void>) => void;
} = {}) {
  const { t, dateLocale } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeThreadMatch = useMatch("/conversations/:id");
  const activeThreadId = activeThreadMatch?.params.id;
  const conversationLinkSuffix = location.search || "";
  const showTelephonyDial = useTelephonyCanDial();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const agentTypingByConversation = useConversationAgentTypingMap();
  const [loading, setLoading] = useState(true);
  const [listSearch, setListSearch] = useState(() => searchParams.get("q") ?? "");
  const [composeOpen, setComposeOpen] = useState(false);
  const [dialOpen, setDialOpen] = useState(false);
  const [quickContact, setQuickContact] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>(() => searchParams.get("teamId") ?? "");
  const [inboxFilter, setInboxFilter] = useState<string>(() => searchParams.get("inboxId") ?? "");
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [inboxOptions, setInboxOptions] = useState<{ id: string; name: string }[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [leadTypeFilter, setLeadTypeFilter] = useState("");
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([]);
  const [leadTypeOptions, setLeadTypeOptions] = useState<{ id: string; name: string }[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    target: ConversationContextTarget;
    position: { x: number; y: number };
  } | null>(null);
  const hasAnimated = useRef(false);
  const listFetchGenRef = useRef(0);
  const listScopeCacheRef = useRef(new Map<string, ConversationListScopeCache>());
  const listFetchKeyRef = useRef("");
  const listPageRef = useRef(1);
  const listTotalRef = useRef(0);
  const listHasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const listViewportRef = useRef<HTMLDivElement>(null);
  const initialAttendanceScopeApplied = useRef(false);
  const listSyncInflightRef = useRef(new Map<string, Promise<void>>());
  const listScopeRef = useRef<ConversationListScopeState>({
    botAttendanceActive: false,
    attendanceScopeActive: false,
    mineActive: false,
    statusFilter: "",
    teamFilter: "",
    inboxFilter: "",
    leadTypeFilter: "",
    hideResolvedInAllScope: false,
    orgAllScopeHumanOnly: false,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [listMotionIds, setListMotionIds] = useState<Set<string>>(() => new Set());

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  const mineActive =
    searchParams.get("mine") === "1" || searchParams.get("mine") === "true";

  const botAttendanceActive =
    searchParams.get("bot") === "1" || searchParams.get("botAttendance") === "1";

  const attendanceScopeActive = searchParams.get("attendance") === "1";

  const [orgAgentBotTriageActive, setOrgAgentBotTriageActive] = useState(false);
  const [orgAttendanceTabEnabled, setOrgAttendanceTabEnabled] = useState(false);
  const [orgAttendanceTabAutoOpen, setOrgAttendanceTabAutoOpen] = useState(true);
  const [orgAllScopeHumanOnly, setOrgAllScopeHumanOnly] = useState(false);
  const [orgListShowContactTags, setOrgListShowContactTags] = useState(false);
  const [orgListShowWhatsappIcon, setOrgListShowWhatsappIcon] = useState(false);
  const [orgQuickContactAddEnabled, setOrgQuickContactAddEnabled] = useState(false);
  const [channelSettingsLoaded, setChannelSettingsLoaded] = useState(false);
  const [scopeCountsLoaded, setScopeCountsLoaded] = useState(false);
  const [scopeCounts, setScopeCounts] = useState({
    org: 0,
    bot: 0,
    attendanceQueue: 0,
    attendanceActive: 0,
    mine: 0,
  });
  const [statusCounts, setStatusCounts] = useState({
    open: 0,
    pending: 0,
    resolved: 0,
  });

  const orgAllScopeActive = !mineActive && !botAttendanceActive && !attendanceScopeActive;
  const hideResolvedInAllScope = orgAllScopeHumanOnly && orgAllScopeActive;

  listScopeRef.current = {
    botAttendanceActive,
    attendanceScopeActive,
    mineActive,
    statusFilter,
    teamFilter,
    inboxFilter,
    leadTypeFilter,
    hideResolvedInAllScope,
    orgAllScopeHumanOnly,
    userId: user?.id,
    userName: user?.name,
  };

  const applyListRowToCache = useCallback((fetchKey: string, rows: Conversation[]) => {
    const cached = listScopeCacheRef.current.get(fetchKey);
    if (cached) {
      listScopeCacheRef.current.set(fetchKey, { ...cached, rows });
    }
  }, []);

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

  /** Dentro da aba Atendimento: fila vs. meus atendimentos (comportamento de `mine` igual ao da lista normal). */
  const setAttendanceSubView = useCallback((sub: "queue" | "mine") => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("bot");
        n.delete("botAttendance");
        n.set("attendance", "1");
        if (sub === "mine") {
          n.set("mine", "1");
        } else {
          n.delete("mine");
          n.delete("status");
        }
        return n;
      },
      { replace: true },
    );
    if (sub === "queue") {
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
        const res = await api.get<{ data: { id: string; name: string }[] }>("/teams?operationalOnly=1");
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
    async function loadListFilterOptions() {
      try {
        const [tags, leadTypes] = await Promise.all([
          api.get<{ id: string; name: string }[]>("/tags").catch(() => []),
          api.get<{ id: string; name: string }[]>("/lead-types").catch(() => []),
        ]);
        setTagOptions(Array.isArray(tags) ? tags.map((x) => ({ id: x.id, name: x.name })) : []);
        setLeadTypeOptions(Array.isArray(leadTypes) ? leadTypes.map((x) => ({ id: x.id, name: x.name })) : []);
      } catch {
        setTagOptions([]);
        setLeadTypeOptions([]);
      }
    }
    void loadListFilterOptions();
  }, []);

  useEffect(() => {
    async function loadChannelSettings() {
      try {
        const res = await api.get<{
          agentBotTriageActive?: boolean;
          conversationsAttendanceTabEnabled?: boolean;
          conversationsAttendanceTabAutoOpen?: boolean;
          conversationsAllScopeHumanOnly?: boolean;
          conversationsListShowContactTags?: boolean;
          conversationsListShowWhatsappIcon?: boolean;
          conversationsQuickContactAddEnabled?: boolean;
        }>("/settings/channel");
        setOrgAgentBotTriageActive(res.agentBotTriageActive === true);
        setOrgAttendanceTabEnabled(res.conversationsAttendanceTabEnabled === true);
        setOrgAttendanceTabAutoOpen(res.conversationsAttendanceTabAutoOpen !== false);
        setOrgAllScopeHumanOnly(res.conversationsAllScopeHumanOnly === true);
        setOrgListShowContactTags(res.conversationsListShowContactTags === true);
        setOrgListShowWhatsappIcon(res.conversationsListShowWhatsappIcon === true);
        setOrgQuickContactAddEnabled(res.conversationsQuickContactAddEnabled === true);
      } catch {
        setOrgAgentBotTriageActive(false);
        setOrgAttendanceTabEnabled(false);
        setOrgAttendanceTabAutoOpen(false);
        setOrgAllScopeHumanOnly(false);
        setOrgListShowContactTags(false);
        setOrgListShowWhatsappIcon(false);
        setOrgQuickContactAddEnabled(false);
      } finally {
        setChannelSettingsLoaded(true);
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
    if (!hideResolvedInAllScope || statusFilter !== "RESOLVED") return;
    setStatusFilter("");
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("status");
        return n;
      },
      { replace: true },
    );
  }, [hideResolvedInAllScope, statusFilter, setSearchParams]);

  useEffect(() => {
    if (attendanceScopeActive && !orgAttendanceTabEnabled) {
      if (mineActive) {
        setSearchParams(
          (prev) => {
            const n = new URLSearchParams(prev);
            n.delete("attendance");
            if (!n.get("mine")) n.set("mine", "1");
            return n;
          },
          { replace: true },
        );
      } else {
        setScopeParam("org");
      }
    }
  }, [attendanceScopeActive, orgAttendanceTabEnabled, mineActive, setScopeParam, setSearchParams]);

  /** Com aba Atendimento activa, «Meus atendimentos» passa a viver sob `attendance=1&mine=1`. */
  useEffect(() => {
    if (
      orgAttendanceTabEnabled &&
      mineActive &&
      !attendanceScopeActive &&
      !botAttendanceActive
    ) {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set("attendance", "1");
          return n;
        },
        { replace: true },
      );
    }
  }, [orgAttendanceTabEnabled, mineActive, attendanceScopeActive, botAttendanceActive, setSearchParams]);

  /** Ao entrar em Conversas, abrir a aba Atendimento se houver conversas na fila. */
  useEffect(() => {
    if (!channelSettingsLoaded || !scopeCountsLoaded || initialAttendanceScopeApplied.current) return;
    if (!orgAttendanceTabEnabled || !orgAttendanceTabAutoOpen) {
      initialAttendanceScopeApplied.current = true;
      return;
    }

    // Com conversa aberta (ex.: refresh em /conversations/:id), não mudar o âmbito —
    // evita que a lista passe de «todas» para «fila de atendimento» e outras conversas sumam.
    if (activeThreadId) {
      initialAttendanceScopeApplied.current = true;
      return;
    }

    const hasExplicitScope =
      searchParams.get("mine") === "1" ||
      searchParams.get("mine") === "true" ||
      searchParams.get("bot") === "1" ||
      searchParams.get("botAttendance") === "1" ||
      searchParams.get("attendance") === "1" ||
      Boolean(searchParams.get("status")) ||
      Boolean(searchParams.get("teamId")) ||
      Boolean(searchParams.get("inboxId"));
    if (hasExplicitScope) {
      initialAttendanceScopeApplied.current = true;
      return;
    }

    if (scopeCounts.attendanceQueue > 0 || scopeCounts.mine > 0) {
      initialAttendanceScopeApplied.current = true;
      setScopeParam("attendance");
      return;
    }

    initialAttendanceScopeApplied.current = true;
  }, [
    activeThreadId,
    channelSettingsLoaded,
    scopeCountsLoaded,
    orgAttendanceTabEnabled,
    orgAttendanceTabAutoOpen,
    scopeCounts.attendanceQueue,
    scopeCounts.mine,
    searchParams,
    setScopeParam,
  ]);

  const buildListFetchKey = useCallback(() => {
    return buildConversationListQuery({
      organizationId: user?.organizationId,
      botAttendanceActive,
      attendanceScopeActive,
      mineActive,
      statusFilter,
      teamFilter,
      inboxFilter,
      leadTypeFilter,
    }).fetchKey;
  }, [
    statusFilter,
    teamFilter,
    inboxFilter,
    leadTypeFilter,
    mineActive,
    botAttendanceActive,
    attendanceScopeActive,
    user?.organizationId,
  ]);

  const buildListQuery = useCallback(() => {
    return buildConversationListQuery({
      organizationId: user?.organizationId,
      botAttendanceActive,
      attendanceScopeActive,
      mineActive,
      statusFilter,
      teamFilter,
      inboxFilter,
      leadTypeFilter,
    });
  }, [
    statusFilter,
    teamFilter,
    inboxFilter,
    leadTypeFilter,
    mineActive,
    botAttendanceActive,
    attendanceScopeActive,
    user?.organizationId,
  ]);

  const activeListFetchKey = useMemo(() => buildListFetchKey(), [buildListFetchKey]);

  useLayoutEffect(() => {
    listFetchKeyRef.current = activeListFetchKey;
    listFetchGenRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    const cached = listScopeCacheRef.current.get(activeListFetchKey);
    if (cached) {
      setConversations(cached.rows);
      listPageRef.current = cached.page;
      listTotalRef.current = cached.total;
      listHasMoreRef.current = cached.rows.length < cached.total;
      setLoading(false);
    } else {
      setConversations([]);
      listPageRef.current = 1;
      listTotalRef.current = 0;
      listHasMoreRef.current = false;
      setLoading(true);
    }
  }, [activeListFetchKey]);

  const syncConversationListAvatars = useCallback(
    (fetchKey: string, gen: number, contactIds: string[]) => {
      if (contactIds.length === 0) return;
      void api
        .post<{ synced: string[]; failed: string[] }>("/contacts/sync-avatars", { contactIds })
        .then((syncRes) => {
          if (gen !== listFetchGenRef.current || listFetchKeyRef.current !== fetchKey) return;
          if (!syncRes.synced?.length) return;
          setConversations((prev) => {
            const next = applySyncedContactAvatars(prev, syncRes.synced);
            const cached = listScopeCacheRef.current.get(fetchKey);
            if (cached) {
              listScopeCacheRef.current.set(fetchKey, { ...cached, rows: next });
            }
            return next;
          });
        })
        .catch(() => {});
    },
    [],
  );

  const persistConversationListIds = useCallback((rows: Conversation[]) => {
    try {
      localStorage.setItem(
        "openconduit_conversation_list_ids",
        JSON.stringify(rows.map((c) => c.id)),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const loadConversations = useCallback(async () => {
    const { fetchKey, params } = buildListQuery();
    params.set("page", "1");
    listFetchKeyRef.current = fetchKey;
    listPageRef.current = 1;
    const gen = ++listFetchGenRef.current;
    const cached = listScopeCacheRef.current.get(fetchKey);

    try {
      const res = await api.get<{ data: Conversation[]; total: number }>(`/conversations?${params}`);
      if (gen !== listFetchGenRef.current || listFetchKeyRef.current !== fetchKey) return;

      const total = res.total ?? res.data.length;
      listTotalRef.current = total;
      listHasMoreRef.current = res.data.length < total;
      listScopeCacheRef.current.set(fetchKey, { rows: res.data, total, page: 1 });
      setConversations(res.data);
      syncConversationListAvatars(
        fetchKey,
        gen,
        res.data.map((c) => c.contact.id).slice(0, 40),
      );
      persistConversationListIds(res.data);
    } catch {
      if (gen !== listFetchGenRef.current || listFetchKeyRef.current !== fetchKey) return;
      if (!cached) {
        setConversations([]);
        listTotalRef.current = 0;
        listHasMoreRef.current = false;
      }
    } finally {
      if (gen === listFetchGenRef.current && listFetchKeyRef.current === fetchKey) {
        hasAnimated.current = true;
        setLoading(false);
      }
    }
  }, [buildListQuery, persistConversationListIds, syncConversationListAvatars]);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreRef.current || !listHasMoreRef.current || loading) return;

    const { fetchKey, params } = buildListQuery();
    const nextPage = listPageRef.current + 1;
    params.set("page", String(nextPage));
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const gen = listFetchGenRef.current;

    try {
      const res = await api.get<{ data: Conversation[]; total: number }>(`/conversations?${params}`);
      if (gen !== listFetchGenRef.current || listFetchKeyRef.current !== fetchKey) return;

      const total = res.total ?? listTotalRef.current;
      listTotalRef.current = total;
      listPageRef.current = nextPage;

      let nextRows: Conversation[] = [];
      let appendedRows: Conversation[] = [];
      setConversations((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        appendedRows = res.data.filter((c) => !existingIds.has(c.id));
        nextRows = appendedRows.length ? [...prev, ...appendedRows] : prev;
        listHasMoreRef.current = nextRows.length < total;
        listScopeCacheRef.current.set(fetchKey, { rows: nextRows, total, page: nextPage });
        return nextRows;
      });
      persistConversationListIds(nextRows);
      syncConversationListAvatars(
        fetchKey,
        gen,
        appendedRows.map((c) => c.contact.id).slice(0, 40),
      );
    } catch {
      /* ignore */
    } finally {
      if (gen === listFetchGenRef.current && listFetchKeyRef.current === fetchKey) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [buildListQuery, loading, persistConversationListIds, syncConversationListAvatars]);

  const onConversationListScroll = useCallback(() => {
    const el = listViewportRef.current;
    if (!el || loading || loadingMoreRef.current || !listHasMoreRef.current) return;
    const threshold = 120;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      void loadMoreConversations();
    }
  }, [loadMoreConversations, loading]);

  useEffect(() => {
    listScopeCacheRef.current.clear();
    listFetchGenRef.current += 1;
  }, [user?.organizationId]);

  const loadScopeCounts = useCallback(async () => {
    if (!channelSettingsLoaded) return;
    setScopeCountsLoaded(false);
    try {
      const base = new URLSearchParams({ page: "1", pageSize: "1" });
      if (teamFilter) base.set("teamId", teamFilter);
      if (inboxFilter) base.set("inboxId", inboxFilter);

      const orgParams = new URLSearchParams(base);
      const botParams = new URLSearchParams(base);
      botParams.set("botAttendance", "1");
      const queueParams = new URLSearchParams(base);
      queueParams.set("waitingAttendance", "1");
      const activeParams = new URLSearchParams(base);
      activeParams.set("activeAttendance", "1");
      const mineParams = new URLSearchParams(base);
      mineParams.set("mine", "1");

      const [orgRes, botRes, queueRes, activeRes, mineRes] = await Promise.all([
        api.get<{ total: number }>(`/conversations?${orgParams}`),
        orgAgentBotTriageActive
          ? api.get<{ total: number }>(`/conversations?${botParams}`)
          : Promise.resolve({ total: 0 }),
        orgAttendanceTabEnabled
          ? api.get<{ total: number }>(`/conversations?${queueParams}`)
          : Promise.resolve({ total: 0 }),
        orgAttendanceTabEnabled
          ? api.get<{ total: number }>(`/conversations?${activeParams}`)
          : Promise.resolve({ total: 0 }),
        api.get<{ total: number }>(`/conversations?${mineParams}`),
      ]);

      setScopeCounts({
        org: orgRes.total ?? 0,
        bot: botRes.total ?? 0,
        attendanceQueue: queueRes.total ?? 0,
        attendanceActive: activeRes.total ?? 0,
        mine: mineRes.total ?? 0,
      });
    } catch {
      /* ignore count errors */
    } finally {
      setScopeCountsLoaded(true);
    }
  }, [teamFilter, inboxFilter, orgAgentBotTriageActive, orgAttendanceTabEnabled, orgAllScopeHumanOnly, channelSettingsLoaded]);

  const statusTabsVisible =
    !botAttendanceActive && (!attendanceScopeActive || mineActive);

  const loadStatusCounts = useCallback(async () => {
    if (!statusTabsVisible) return;
    try {
      const base = new URLSearchParams({ page: "1", pageSize: "1" });
      if (teamFilter) base.set("teamId", teamFilter);
      if (inboxFilter) base.set("inboxId", inboxFilter);
      if (leadTypeFilter) base.set("leadTypeId", leadTypeFilter);
      if (attendanceScopeActive && mineActive) {
        base.set("mine", "1");
      } else if (mineActive) {
        base.set("mine", "1");
      }

      const fetchTotal = (status: "OPEN" | "PENDING" | "RESOLVED") => {
        const params = new URLSearchParams(base);
        params.set("status", status);
        return api.get<{ total: number }>(`/conversations?${params}`);
      };

      const [openRes, pendingRes, resolvedRes] = await Promise.all([
        fetchTotal("OPEN"),
        fetchTotal("PENDING"),
        hideResolvedInAllScope && !mineActive && !(attendanceScopeActive && mineActive)
          ? Promise.resolve({ total: 0 })
          : fetchTotal("RESOLVED"),
      ]);

      setStatusCounts({
        open: openRes.total ?? 0,
        pending: pendingRes.total ?? 0,
        resolved: resolvedRes.total ?? 0,
      });
    } catch {
      /* ignore count errors */
    }
  }, [
    statusTabsVisible,
    teamFilter,
    inboxFilter,
    leadTypeFilter,
    mineActive,
    attendanceScopeActive,
    hideResolvedInAllScope,
  ]);

  const syncConversationListRow = useCallback(
    async (conversationId: string, options?: { highlight?: "enter" | "transfer" | "exit" }) => {
      const existing = listSyncInflightRef.current.get(conversationId);
      if (existing) return existing;

      const promise = (async () => {
        const scope = listScopeRef.current;
        const fetchKey = listFetchKeyRef.current;
        try {
          const row = await api.get<Conversation>(`/conversations/${conversationId}/list-row`);
          const matches = conversationMatchesListScope(row, scope);

          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === conversationId);
            if (!matches) {
              if (idx < 0) return prev;
              return prev.filter((c) => c.id !== conversationId);
            }
            const existing = idx >= 0 ? prev[idx] : null;
            const mergedRow =
              row.messages?.length || !existing?.messages?.length
                ? row
                : { ...row, messages: existing.messages };
            const without = prev.filter((c) => c.id !== conversationId);
            const next = [mergedRow, ...without];
            applyListRowToCache(fetchKey, next);
            persistConversationListIds(next);
            return next;
          });

          if (matches && options?.highlight) {
            setListMotionIds((prev) => new Set(prev).add(conversationId));
            window.setTimeout(() => {
              setListMotionIds((prev) => {
                const next = new Set(prev);
                next.delete(conversationId);
                return next;
              });
            }, options.highlight === "exit" ? 400 : 1200);
          }

          void loadScopeCounts();
          void loadStatusCounts();
        } catch {
          setConversations((prev) => {
            if (!prev.some((c) => c.id === conversationId)) return prev;
            const next = prev.filter((c) => c.id !== conversationId);
            applyListRowToCache(fetchKey, next);
            return next;
          });
          if (options?.highlight === "exit") {
            setListMotionIds((prev) => new Set(prev).add(conversationId));
            window.setTimeout(() => {
              setListMotionIds((prev) => {
                const next = new Set(prev);
                next.delete(conversationId);
                return next;
              });
            }, 400);
          }
          void loadScopeCounts();
          void loadStatusCounts();
        }
      })().finally(() => {
        listSyncInflightRef.current.delete(conversationId);
      });

      listSyncInflightRef.current.set(conversationId, promise);
      return promise;
    },
    [applyListRowToCache, loadScopeCounts, loadStatusCounts, persistConversationListIds],
  );

  const syncConversationFromHint = useCallback(
    (detail: ConversationUpdatedDetail | undefined, highlight?: "enter" | "transfer" | "exit") => {
      const conversationId = detail?.conversationId;
      if (!conversationId) return;

      const scope = listScopeRef.current;
      let fetchRow = false;
      let removed = false;

      setConversations((prev) => {
        const existing = prev.find((c) => c.id === conversationId);
        if (!existing) {
          fetchRow = true;
          return prev;
        }
        const merged = mergeConversationScopeHint(existing, detail, {
          currentUserId: scope.userId,
          currentUserName: scope.userName,
        });
        if (!conversationMatchesListScope(merged, scope)) {
          removed = true;
          const next = prev.filter((c) => c.id !== conversationId);
          applyListRowToCache(listFetchKeyRef.current, next);
          return next;
        }
        const patched = {
          ...existing,
          ...merged,
          updatedAt: detail?.updatedAt ?? existing.updatedAt,
        };
        const next = [patched, ...prev.filter((c) => c.id !== conversationId)];
        applyListRowToCache(listFetchKeyRef.current, next);
        return next;
      });

      if (fetchRow) {
        void syncConversationListRow(conversationId, { highlight: highlight ?? "enter" });
        return;
      }

      if (highlight) {
        setListMotionIds((prev) => new Set(prev).add(conversationId));
        window.setTimeout(() => {
          setListMotionIds((prev) => {
            const next = new Set(prev);
            next.delete(conversationId);
            return next;
          });
        }, removed ? 400 : 1200);
      }
      void loadScopeCounts();
      void loadStatusCounts();
    },
    [applyListRowToCache, loadScopeCounts, loadStatusCounts, syncConversationListRow],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    onRegisterRefresh?.(loadConversations);
  }, [loadConversations, onRegisterRefresh]);

  const prefetchConversation = useCallback((conversationId: string) => {
    if (getCachedConversation(conversationId)) return;
    const existing = getInflightConversation(conversationId);
    if (existing) return;
    const promise = api.get(`/conversations/${conversationId}`).then((data) => {
      setCachedConversation(conversationId, data);
      return data;
    });
    setInflightConversation(conversationId, promise);
  }, []);

  useEffect(() => {
    void loadScopeCounts();
  }, [loadScopeCounts]);

  useEffect(() => {
    void loadStatusCounts();
  }, [loadStatusCounts]);

  useDebouncedConversationUpdated(() => {
    void loadScopeCounts();
    void loadStatusCounts();
  });

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<ConversationUpdatedDetail>).detail;
      if (!detail?.conversationId) return;
      const hasStructuralChange =
        detail.status ||
        detail.assignedToId !== undefined ||
        detail.teamId !== undefined ||
        detail.inboxId ||
        detail.awaitingHumanHandoff !== undefined ||
        detail.agentBotTriageActive !== undefined;
      if (hasStructuralChange) {
        syncConversationFromHint(detail);
        return;
      }
      // Nova mensagem: preview já vem via message.created — evita GET list-row sem preview.
    };
    const onTransferred = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string }>).detail;
      if (!detail?.conversationId) return;
      void syncConversationListRow(detail.conversationId, { highlight: "transfer" });
    };
    window.addEventListener("openconduit:conversation-updated", onUpdated);
    window.addEventListener("openconduit:conversation-transferred", onTransferred);
    return () => {
      window.removeEventListener("openconduit:conversation-updated", onUpdated);
      window.removeEventListener("openconduit:conversation-transferred", onTransferred);
    };
  }, [syncConversationFromHint, syncConversationListRow]);

  useEffect(() => {
    const onMessageCreated = (e: Event) => {
      const detail = (e as CustomEvent<ConversationMessageCreatedDetail>).detail;
      if (!detail?.conversationId || !detail.message) return;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === detail.conversationId);
        if (idx < 0) {
          void syncConversationListRow(detail.conversationId, { highlight: "enter" });
          return prev;
        }
        const conv = prev[idx];
        const preview = {
          body: detail.message.body,
          direction: detail.message.direction,
          createdAt: detail.message.createdAt,
          type: detail.message.type,
        };
        const updated: Conversation = {
          ...conv,
          updatedAt: detail.message.createdAt,
          isUnread: detail.message.direction === "INBOUND" ? true : conv.isUnread,
          messages: [preview, ...(conv.messages?.slice(1) ?? [])],
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    };
    window.addEventListener(CONVERSATION_MESSAGE_CREATED_EVENT, onMessageCreated);
    return () => window.removeEventListener(CONVERSATION_MESSAGE_CREATED_EVENT, onMessageCreated);
  }, []);

  useEffect(() => {
    const onRead = (e: Event) => {
      const conversationId = (e as CustomEvent<{ conversationId?: string }>).detail?.conversationId;
      if (!conversationId) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, isUnread: false } : c)),
      );
    };
    window.addEventListener("openconduit:conversation-read", onRead);
    return () => window.removeEventListener("openconduit:conversation-read", onRead);
  }, []);

  const digitsOnly = (s: string) => s.replace(/\D/g, "");
  const listFiltersActive = Boolean(listSearch.trim() || tagFilter || leadTypeFilter);
  const filteredConversations = useMemo(() => {
    let rows = conversations;
    if (tagFilter) {
      rows = rows.filter((c) => c.contact.tags?.some((x) => x.tag.id === tagFilter));
    }
    if (leadTypeFilter) {
      rows = rows.filter((c) => conversationLeadTypeId(c) === leadTypeFilter);
    }
    const raw = listSearch.trim().toLowerCase();
    if (!raw) return rows;
    const dRaw = digitsOnly(raw);
    return rows.filter((c) => {
      const name = c.contact.name.toLowerCase();
      const phone = c.contact.phone ?? "";
      const phoneDigits = digitsOnly(phone);
      const last = formatMessageBodyForPreview(c.messages?.[0]?.body, {
        messageType: c.messages?.[0]?.type,
      }).toLowerCase();
      if (name.includes(raw)) return true;
      if (dRaw && phoneDigits.includes(dRaw)) return true;
      if (phone.toLowerCase().includes(raw)) return true;
      if (last.includes(raw)) return true;
      return false;
    });
  }, [conversations, listSearch, tagFilter, leadTypeFilter]);

  const statusLabel = (s: string) => {
    if (s === "OPEN") return t("conversationDetail.statusOpen");
    if (s === "PENDING") return t("conversationDetail.statusPending");
    if (s === "RESOLVED") return t("conversationDetail.statusResolved");
    return s;
  };

  const filters: { key: string; label: string }[] = useMemo(() => {
    const base = [
      { key: "", label: t("common.all") },
      { key: "OPEN", label: t("conversations.filterOpen") },
      { key: "PENDING", label: t("conversations.filterPending") },
      { key: "RESOLVED", label: t("conversations.filterResolved") },
    ];
    if (hideResolvedInAllScope) {
      return base.filter((f) => f.key !== "RESOLVED");
    }
    return base;
  }, [hideResolvedInAllScope, t]);

  const scopePillClass = splitView
    ? "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors"
    : "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors";
  const statusPillClass = splitView
    ? "rounded-full px-2 py-1 text-[11px] font-semibold transition-colors"
    : "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors";
  const listFilterSelectClass = splitView
    ? "conversations-filter-select conversations-filter-select--split"
    : "conversations-filter-select conversations-filter-select--default";

  return (
    <PageTransition>
      <div className={clsx("relative h-full min-h-0", splitView && "flex flex-col")}>
        {!splitView ? (
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(103,52,255,0.08)_0%,_transparent_55%)] dark:bg-[radial-gradient(ellipse_80%_45%_at_50%_0%,rgba(99,102,241,0.16),transparent_60%)]" />
        ) : null}
        <div
          className={clsx(
            "relative flex h-full min-h-0 w-full flex-col gap-4",
            splitView ? "gap-0 p-0" : "p-4 sm:p-6 lg:p-8",
          )}
        >
          {!splitView ? (
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
                {t("conversations.title")}
                <HelpContextButton articleSlug="conversations/overview" className="p-1" />
              </h1>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("conversations.subtitle")}</p>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:max-w-4xl">
              <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
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
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label htmlFor="conv-tag-filter" className="sr-only">
                    {t("conversations.filterTag")}
                  </label>
                  <select
                    id="conv-tag-filter"
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className={listFilterSelectClass}
                  >
                    <option value="">{t("conversations.allTags")}</option>
                    {tagOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="conv-lead-type-filter" className="sr-only">
                    {t("conversations.filterLeadType")}
                  </label>
                  <select
                    id="conv-lead-type-filter"
                    value={leadTypeFilter}
                    onChange={(e) => setLeadTypeFilter(e.target.value)}
                    className={listFilterSelectClass}
                  >
                    <option value="">{t("conversations.allLeadTypes")}</option>
                    {leadTypeOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setComposeOpen(true)}
                    className="btn-primary inline-flex h-11 w-11 shrink-0 rounded-xl p-0 shadow-md shadow-brand-500/20"
                    title={t("conversations.newMessageTooltip")}
                    aria-label={t("conversations.newMessageTooltip")}
                  >
                    <MessageSquarePlus className="h-5 w-5" />
                  </button>
                  {showTelephonyDial ? (
                    <button
                      type="button"
                      onClick={() => setDialOpen(true)}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md transition hover:bg-emerald-600 hover:shadow-lg"
                      title={t("telephony.dial.openTooltip")}
                      aria-label={t("telephony.dial.openTooltip")}
                    >
                      <Phone className="h-5 w-5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </header>
          ) : (
          <ConversationsSplitToolbar
            listSearch={listSearch}
            onListSearchChange={setListSearch}
            onCompose={() => setComposeOpen(true)}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            leadTypeFilter={leadTypeFilter}
            onLeadTypeFilterChange={setLeadTypeFilter}
            tagOptions={tagOptions}
            leadTypeOptions={leadTypeOptions}
            orgAttendanceTabEnabled={orgAttendanceTabEnabled}
            orgAgentBotTriageActive={orgAgentBotTriageActive}
            attendanceScopeActive={attendanceScopeActive}
            mineActive={mineActive}
            botAttendanceActive={botAttendanceActive}
            scopeCounts={scopeCounts}
            statusCounts={statusCounts}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusFilters={filters}
            teamFilter={teamFilter}
            onTeamFilterChange={setTeamFilterUrl}
            inboxFilter={inboxFilter}
            onInboxFilterChange={setInboxFilterUrl}
            teamOptions={teamOptions}
            inboxOptions={inboxOptions}
            onScopeChange={setScopeParam}
            onAttendanceSubView={setAttendanceSubView}
          />
          )}

          <section
            className={clsx(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              splitView
                ? "border-0 bg-transparent shadow-none"
                : "card-surface",
            )}
          >
            {!splitView ? (
            <div
              className={clsx(
                "flex flex-col gap-2 border-b border-ink-100 bg-white/70 backdrop-blur-sm dark:border-ink-800 dark:bg-ink-950/25",
                "flex-wrap items-center justify-between gap-3 px-4 py-3",
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {orgAttendanceTabEnabled ? (
                  <button
                    type="button"
                    onClick={() => setScopeParam("attendance")}
                    className={clsx(
                      scopePillClass,
                      attendanceScopeActive
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                    )}
                  >
                    <Headset className="h-3.5 w-3.5" />
                    {t("conversations.scopeAttendance")}
                    <ScopeTabCount count={scopeCounts.attendanceActive} selected={attendanceScopeActive} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setScopeParam("org")}
                  className={clsx(
                    scopePillClass,
                    !mineActive && !botAttendanceActive && !attendanceScopeActive
                      ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("conversations.scopeOrg")}
                  <ScopeTabCount
                    count={scopeCounts.org}
                    selected={!mineActive && !botAttendanceActive && !attendanceScopeActive}
                  />
                </button>
                {!orgAttendanceTabEnabled ? (
                  <button
                    type="button"
                    onClick={() => setScopeParam("mine")}
                    className={clsx(
                      scopePillClass,
                      mineActive
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                    )}
                  >
                    <UserCircle className="h-3.5 w-3.5" />
                    {t("conversations.myAssignments")}
                    <ScopeTabCount count={scopeCounts.mine} selected={mineActive} />
                  </button>
                ) : null}
                {orgAgentBotTriageActive ? (
                  <button
                    type="button"
                    onClick={() => setScopeParam("bot")}
                    className={clsx(
                      scopePillClass,
                      botAttendanceActive
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                    )}
                  >
                    <Bot className={clsx("h-3.5 w-3.5", botAttendanceActive && "animate-bot-head-nod")} />
                    {t("conversations.scopeBotAttendance")}
                    <ScopeTabCount count={scopeCounts.bot} selected={botAttendanceActive} />
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!botAttendanceActive && (!attendanceScopeActive || mineActive) ? (
                <div className="flex flex-wrap gap-1 rounded-full bg-ink-100 p-1 dark:bg-ink-900/60">
                  {filters.map((f) => (
                    <button
                      key={f.key || "all"}
                      type="button"
                      onClick={() => setStatusFilter(f.key)}
                      className={clsx(
                        statusPillClass,
                        statusFilter === f.key
                          ? "bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-ink-50"
                          : "text-ink-600 hover:bg-ink-200/70 dark:text-ink-300 dark:hover:bg-ink-900",
                      )}
                    >
                      {f.label}
                      {f.key === "OPEN" ? (
                        <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-200">
                          {statusCounts.open}
                        </span>
                      ) : f.key === "PENDING" ? (
                        <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                          {statusCounts.pending}
                        </span>
                      ) : f.key === "RESOLVED" ? (
                        <span className="ml-2 rounded-full bg-ink-300/30 px-1.5 py-0.5 text-[10px] font-bold text-ink-700 dark:bg-ink-700/50 dark:text-ink-200">
                          {statusCounts.resolved}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                ) : null}

                <div className={clsx("flex items-center gap-1.5", "hidden gap-2 md:flex")}>
                  <UsersRound className="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-ink-500" />
                  <label htmlFor="conv-team-filter" className="sr-only">
                    {t("conversations.filterTeam")}
                  </label>
                  <select
                    id="conv-team-filter"
                    value={teamFilter}
                    onChange={(e) => setTeamFilterUrl(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-800 dark:border-ink-700 dark:bg-ink-950/20 dark:text-ink-100"
                  >
                    <option value="">{t("conversations.allTeams")}</option>
                    {teamOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  <Inbox className="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-ink-500" />
                  <label htmlFor="conv-inbox-filter" className="sr-only">
                    {t("conversations.filterInbox")}
                  </label>
                  <select
                    id="conv-inbox-filter"
                    value={inboxFilter}
                    onChange={(e) => setInboxFilterUrl(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-800 dark:border-ink-700 dark:bg-ink-950/20 dark:text-ink-100"
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
            ) : null}

            {!splitView && orgAttendanceTabEnabled && attendanceScopeActive ? (
              <div
                className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-white/50 px-4 py-2 dark:border-ink-800 dark:bg-ink-950/15"
              >
                <button
                  type="button"
                  onClick={() => setAttendanceSubView("queue")}
                  className={clsx(
                    scopePillClass,
                    !mineActive
                      ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                  )}
                >
                  <Clock className="h-3.5 w-3.5" />
                  {t("conversations.attendanceQueue")}
                  <ScopeTabCount count={scopeCounts.attendanceQueue} selected={!mineActive} />
                </button>
                <button
                  type="button"
                  onClick={() => setAttendanceSubView("mine")}
                  className={clsx(
                    scopePillClass,
                    mineActive
                      ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200 dark:bg-ink-900/60 dark:text-ink-200 dark:hover:bg-ink-900",
                  )}
                >
                  <UserCircle className="h-3.5 w-3.5" />
                  {t("conversations.myAssignments")}
                  <ScopeTabCount count={scopeCounts.mine} selected={mineActive} />
                </button>
              </div>
            ) : null}

            <div
              ref={listViewportRef}
              onScroll={onConversationListScroll}
              className={clsx("min-h-0 flex-1 overflow-y-auto", splitView ? "p-0" : "p-3 sm:p-4")}
            >
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
                    {listFiltersActive && conversations.length > 0
                      ? t("conversations.emptySearchTitle")
                      : botAttendanceActive
                        ? t("conversations.emptyBotTitle")
                        : attendanceScopeActive && mineActive
                          ? t("conversations.emptyMineTitle")
                          : attendanceScopeActive
                            ? t("conversations.emptyAttendanceTitle")
                            : mineActive
                              ? t("conversations.emptyMineTitle")
                              : t("conversations.emptyTitle")}
                  </p>
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-500">
                    {listFiltersActive && conversations.length > 0
                      ? t("conversations.emptySearchHint")
                      : botAttendanceActive
                        ? t("conversations.emptyBotHint")
                        : attendanceScopeActive && mineActive
                          ? t("conversations.emptyMineHint")
                          : attendanceScopeActive
                            ? t("conversations.emptyAttendanceHint")
                            : mineActive
                              ? t("conversations.emptyMineHint")
                              : t("conversations.emptyHint")}
                  </p>
                </motion.div>
              ) : (
                <AnimatePresence initial={false} mode="popLayout">
                  {filteredConversations.map((conv) => (
                    <motion.div
                      key={conv.id}
                      layout
                      initial={{ opacity: 0, y: -10, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -28, height: 0, marginTop: 0, marginBottom: 0, overflow: "hidden" }}
                      transition={{ duration: 0.26, ease: "easeOut" }}
                      className={clsx(
                        listMotionIds.has(conv.id) &&
                          "rounded-xl ring-2 ring-brand-400/70 shadow-[0_0_0_1px_rgba(103,52,255,0.12)] transition-shadow duration-300 dark:ring-brand-500/50",
                      )}
                    >
                      <ConversationListItem
                        conv={conv}
                        isSelected={Boolean(splitView && activeThreadId === conv.id)}
                        linkTo={`/conversations/${conv.id}${conversationLinkSuffix}`}
                        statusLabel={statusLabel}
                        fmtMoney={fmtMoney}
                        showContactTags={orgListShowContactTags}
                        showWhatsappIcon={!splitView || orgListShowWhatsappIcon}
                        splitView={splitView}
                        agentTyping={agentTypingByConversation.get(conv.id) ?? null}
                        currentUserId={user?.id}
                        onPrefetch={() => prefetchConversation(conv.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            target: {
                              id: conv.id,
                              status: conv.status,
                              priority: conv.priority ?? null,
                              isUnread: conv.isUnread,
                              contact: { id: conv.contact.id, name: conv.contact.name },
                            },
                            position: { x: e.clientX, y: e.clientY },
                          });
                        }}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {!loading && loadingMore ? (
                <div
                  className="flex justify-center py-4"
                  role="status"
                  aria-label={t("conversations.loadingMore")}
                >
                  <div
                    className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-500/20 border-t-brand-500 dark:border-brand-400/25 dark:border-t-brand-400"
                    aria-hidden
                  />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      <ConversationsStartChatModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        quickContactAddEnabled={orgQuickContactAddEnabled}
        onPickContact={(c) => {
          setQuickContact(c);
          setComposeOpen(false);
        }}
      />
      <TelephonyDialModal open={dialOpen && showTelephonyDial} onClose={() => setDialOpen(false)} />
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
        preferSubmenuLeft={splitView}
        onClose={() => setContextMenu(null)}
        onUpdated={(update) => {
          if (update?.id) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === update.id
                  ? {
                      ...c,
                      ...(update.status !== undefined ? { status: update.status } : {}),
                      ...(update.priority !== undefined ? { priority: update.priority } : {}),
                      ...(update.isUnread !== undefined ? { isUnread: update.isUnread } : {}),
                    }
                  : c,
              ),
            );
          }
          void loadConversations();
        }}
        onDeleted={(conversationId) => {
          setConversations((prev) => {
            const next = prev.filter((c) => c.id !== conversationId);
            const cached = listScopeCacheRef.current.get(listFetchKeyRef.current);
            const total = Math.max(0, (cached?.total ?? listTotalRef.current) - 1);
            listTotalRef.current = total;
            listHasMoreRef.current = next.length < total;
            listScopeCacheRef.current.set(listFetchKeyRef.current, {
              rows: next,
              total,
              page: listPageRef.current,
            });
            return next;
          });
          setContextMenu(null);
          if (splitView && activeThreadId === conversationId) {
            navigate(`/conversations${conversationLinkSuffix}`, { replace: true });
          }
        }}
      />
    </PageTransition>
  );
}
