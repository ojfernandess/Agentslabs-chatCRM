import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  BookOpen,
  Command,
  FileText,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  UsersRound,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition, motion } from "@/components/Motion";
import { TeamCommandPalette, type CommandAction } from "./TeamCommandPalette";
import { TeamOperationalAdmin } from "./TeamOperationalAdmin";
import { ChannelManageModal, type ChannelFormState } from "./ChannelManageModal";
import { TeamChannelChat } from "./TeamChannelChat";

type HubTab = "overview" | "channels" | "workspace" | "admin";
type WorkspaceFilter = "NOTE" | "WIKI" | "SNIPPET" | "FILE_LINK";

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  _count?: { members: number; conversations: number };
  unseenTransferCount?: number;
}

interface HubOverview {
  team: { id: string; name: string; description: string | null };
  stats: {
    conversations: Record<string, number>;
    channelCount: number;
    workspaceCount: number;
    memberCount: number;
  };
  members: { userId: string; role: string; user: { id: string; name: string; displayName?: string | null } }[];
  recentConversations: {
    id: string;
    status: string;
    updatedAt: string;
    contact: { id: string; name: string };
    assignedTo: { id: string; name: string } | null;
  }[];
  recentChannelActivity: {
    id: string;
    body: string;
    createdAt: string;
    channel: { id: string; name: string };
    author: { id: string; name: string };
  }[];
}

interface ChannelRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  messageCount: number;
  lastMessage: { createdAt: string; body: string } | null;
}

interface WorkspaceItem {
  id: string;
  itemType: WorkspaceFilter;
  title: string;
  content: string | null;
  fileUrl: string | null;
  pinned: boolean;
  updatedAt: string;
  createdBy: { id: string; name: string };
}

export function TeamsCollaborationHub() {
  const { t, dateLocale } = useI18n();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const channelsOn = user?.organizationFeatures?.teams_channels ?? false;
  const workspaceOn = user?.organizationFeatures?.teams_workspace ?? false;
  const aiOn = user?.organizationFeatures?.teams_ai_copilot ?? false;
  const realtimeOn = user?.organizationFeatures?.teams_realtime_ops ?? false;

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<HubTab>("overview");
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [overview, setOverview] = useState<HubOverview | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("NOTE");
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [wsTitle, setWsTitle] = useState("");
  const [wsContent, setWsContent] = useState("");
  const [wsFileUrl, setWsFileUrl] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [channelModal, setChannelModal] = useState<"create" | "edit" | null>(null);
  const [channelModalBusy, setChannelModalBusy] = useState(false);
  const [channelDeletingId, setChannelDeletingId] = useState<string | null>(null);

  const selected = teams.find((x) => x.id === selectedId) ?? teams[0] ?? null;

  const loadTeams = useCallback(async () => {
    try {
      const res = await api.get<{ data: TeamRow[] }>("/teams");
      setTeams(res.data);
      const teamFromUrl = searchParams.get("teamId")?.trim();
      setSelectedId((prev) => {
        if (teamFromUrl && res.data.some((t) => t.id === teamFromUrl)) return teamFromUrl;
        if (prev && res.data.some((t) => t.id === prev)) return prev;
        return res.data[0]?.id ?? null;
      });
    } catch {
      setTeams([]);
    }
  }, [searchParams]);

  const loadOverview = useCallback(async (teamId: string) => {
    try {
      const data = await api.get<HubOverview>(`/teams/${teamId}/hub/overview`);
      setOverview(data);
    } catch {
      setOverview(null);
    }
  }, []);

  const loadChannels = useCallback(async (teamId: string) => {
    if (!channelsOn) return;
    try {
      const res = await api.get<{ data: ChannelRow[] }>(`/teams/${teamId}/channels`);
      setChannels(res.data);
      setActiveChannelId((prev) => {
        if (prev && res.data.some((c) => c.id === prev)) return prev;
        return res.data[0]?.id ?? null;
      });
    } catch {
      setChannels([]);
    }
  }, [channelsOn]);

  const loadWorkspace = useCallback(
    async (teamId: string, type: WorkspaceFilter) => {
      if (!workspaceOn) return;
      try {
        const res = await api.get<{ data: WorkspaceItem[] }>(
          `/teams/${teamId}/workspace?type=${type}`,
        );
        setWorkspaceItems(res.data);
      } catch {
        setWorkspaceItems([]);
      }
    },
    [workspaceOn],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadTeams();
      setLoading(false);
    })();
  }, [loadTeams]);

  useEffect(() => {
    if (!selected?.id) return;
    void loadOverview(selected.id);
    void loadChannels(selected.id);
    if (workspaceOn) void loadWorkspace(selected.id, workspaceFilter);
  }, [selected?.id, loadOverview, loadChannels, loadWorkspace, workspaceFilter, workspaceOn]);

  useEffect(() => {
    if (!realtimeOn || !selected?.id) return;
    const id = window.setInterval(() => {
      void loadOverview(selected.id);
      if (channelsOn) void loadChannels(selected.id);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [realtimeOn, selected?.id, loadOverview, loadChannels, channelsOn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleCreateTeam = async (e: FormEvent) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name || !isAdmin) return;
    setCreating(true);
    try {
      await api.post("/teams", { name });
      setNewTeamName("");
      await loadTeams();
    } finally {
      setCreating(false);
    }
  };

  const addWorkspaceItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected?.id || !wsTitle.trim()) return;
    await api.post(`/teams/${selected.id}/workspace`, {
      itemType: workspaceFilter,
      title: wsTitle.trim(),
      content: wsContent.trim() || undefined,
      fileUrl: workspaceFilter === "FILE_LINK" && wsFileUrl.trim() ? wsFileUrl.trim() : undefined,
    });
    setWsTitle("");
    setWsContent("");
    setWsFileUrl("");
    await loadWorkspace(selected.id, workspaceFilter);
    await loadOverview(selected.id);
  };

  const runAi = async () => {
    if (!selected?.id || !aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      const res = await api.post<{ answer: string }>(`/teams/${selected.id}/hub/ai`, {
        prompt: aiPrompt.trim(),
      });
      setAiAnswer(res.answer);
    } catch {
      setAiAnswer(t("teamsHub.aiError"));
    } finally {
      setAiBusy(false);
    }
  };

  const paletteActions = useMemo((): CommandAction[] => {
    const list: CommandAction[] = [
      { id: "tab-overview", label: t("teamsHub.tabOverview"), onRun: () => setTab("overview") },
    ];
    if (channelsOn) {
      list.push({ id: "tab-channels", label: t("teamsHub.tabChannels"), onRun: () => setTab("channels") });
    }
    if (workspaceOn) {
      list.push({ id: "tab-workspace", label: t("teamsHub.tabWorkspace"), onRun: () => setTab("workspace") });
    }
    if (isAdmin) {
      list.push({ id: "tab-admin", label: t("teamsHub.tabAdmin"), onRun: () => setShowAdmin(true) });
    }
    for (const team of teams) {
      list.push({
        id: `team-${team.id}`,
        label: team.name,
        hint: t("teamsHub.selectTeam"),
        onRun: () => setSelectedId(team.id),
      });
    }
    return list;
  }, [channelsOn, workspaceOn, isAdmin, teams, t]);

  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;

  const submitChannelModal = async (data: ChannelFormState) => {
    if (!selected?.id) return;
    setChannelModalBusy(true);
    try {
      if (channelModal === "create") {
        await api.post(`/teams/${selected.id}/channels`, data);
      } else if (channelModal === "edit" && activeChannelId) {
        await api.patch(`/teams/${selected.id}/channels/${activeChannelId}`, data);
      }
      setChannelModal(null);
      await loadChannels(selected.id);
    } catch {
      window.alert(t("teamsHub.channelSaveError"));
    } finally {
      setChannelModalBusy(false);
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!selected?.id || !isAdmin) return;
    if (!window.confirm(t("teamsHub.channelDeleteConfirm"))) return;
    setChannelDeletingId(channelId);
    try {
      await api.delete(`/teams/${selected.id}/channels/${channelId}`);
      if (activeChannelId === channelId) setActiveChannelId(null);
      await loadChannels(selected.id);
    } catch {
      window.alert(t("teamsHub.channelDeleteError"));
    } finally {
      setChannelDeletingId(null);
    }
  };

  if (showAdmin && isAdmin && selected) {
    return <TeamOperationalAdmin teamId={selected.id} onBack={() => setShowAdmin(false)} />;
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="flex min-h-0 min-w-0 flex-col bg-gradient-to-br from-slate-50 via-white to-violet-50/30 dark:from-ink-950 dark:via-ink-950 dark:to-violet-950/20 md:h-[calc(100dvh-3.5rem)]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-200/80 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/80 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-lg shadow-brand-500/25">
              <UsersRound className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">{t("teamsHub.title")}</h1>
              <p className="text-xs text-ink-500 dark:text-ink-400">{t("teamsHub.subtitle")}</p>
            </div>
          </div>
          {teams.length > 0 ? (
            <label className="flex w-full min-w-0 flex-col gap-1 md:hidden">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{t("teamsHub.mobileTeamSelect")}</span>
              <select
                className="input-field h-10 w-full text-sm"
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value || null)}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex items-center gap-2">
            {realtimeOn ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {t("teamsHub.live")}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 shadow-sm hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
            >
              <Command className="h-3.5 w-3.5" />
              {t("teamsHub.commandPalette")}
              <kbd className="rounded bg-ink-100 px-1 text-[10px] dark:bg-ink-800">⌘K</kbd>
            </button>
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
          <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-200/80 bg-white/60 dark:border-ink-800 dark:bg-ink-950/40 md:flex">
            {isAdmin ? (
              <form onSubmit={handleCreateTeam} className="border-b border-ink-100 p-3 dark:border-ink-800">
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder={t("teams.namePlaceholder")}
                  className="input-field mb-2 h-9 w-full text-sm"
                />
                <button type="submit" disabled={creating || !newTeamName.trim()} className="btn-primary w-full text-xs">
                  <Plus className="mr-1 inline h-3.5 w-3.5" />
                  {t("teams.create")}
                </button>
              </form>
            ) : null}
            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {teams.map((team) => (
                <li key={team.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(team.id)}
                    className={clsx(
                      "mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition",
                      selected?.id === team.id
                        ? "bg-brand-500/15 font-semibold text-brand-900 ring-1 ring-brand-500/30 dark:text-brand-100"
                        : "text-ink-700 hover:bg-ink-100/80 dark:text-ink-200 dark:hover:bg-ink-900/60",
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-brand-500/20 text-xs font-bold text-violet-800 dark:text-violet-200">
                      {team.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    {(team.unseenTransferCount ?? 0) > 0 ? (
                      <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {team.unseenTransferCount}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <nav className="flex shrink-0 flex-wrap gap-1 border-b border-ink-100 bg-white/50 px-4 py-2 dark:border-ink-800 dark:bg-ink-950/30">
                  {(
                    [
                      { id: "overview" as const, label: t("teamsHub.tabOverview"), icon: LayoutDashboard },
                      channelsOn ? { id: "channels" as const, label: t("teamsHub.tabChannels"), icon: Hash } : null,
                      workspaceOn ? { id: "workspace" as const, label: t("teamsHub.tabWorkspace"), icon: BookOpen } : null,
                      isAdmin ? { id: "admin" as const, label: t("teamsHub.tabAdmin"), icon: UsersRound } : null,
                    ].filter(Boolean) as { id: HubTab; label: string; icon: typeof LayoutDashboard }[]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.id === "admin") setShowAdmin(true);
                        else setTab(item.id);
                      }}
                      className={clsx(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                        (item.id === "admin" ? showAdmin : tab === item.id)
                          ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900"
                          : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-900",
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  ))}
                </nav>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
                  {tab === "overview" && overview ? (
                    <div className="space-y-6">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          { key: "OPEN", label: t("conversations.filterOpen"), color: "emerald" },
                          { key: "PENDING", label: t("conversations.filterPending"), color: "amber" },
                          { key: "RESOLVED", label: t("conversations.filterResolved"), color: "slate" },
                          { key: "members", label: t("teams.memberCount"), val: overview.stats.memberCount, color: "violet" },
                        ].map((card) => (
                          <motion.div
                            key={card.key}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm dark:border-ink-800 dark:bg-ink-950/60"
                          >
                            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{card.label}</p>
                            <p className="mt-2 text-2xl font-bold tabular-nums text-ink-900 dark:text-ink-50">
                              {"val" in card ? card.val : overview.stats.conversations[card.key] ?? 0}
                            </p>
                          </motion.div>
                        ))}
                      </div>

                      <section className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-ink-800 dark:bg-ink-950/60">
                          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
                            <MessageSquare className="h-4 w-4 text-brand-500" />
                            {t("teamsHub.recentConversations")}
                          </h2>
                          <ul className="space-y-2">
                            {overview.recentConversations.map((c) => (
                              <li key={c.id}>
                                <Link
                                  to={`/conversations/${c.id}`}
                                  className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2 text-sm hover:border-brand-300 hover:bg-brand-50/50 dark:border-ink-800 dark:hover:bg-brand-950/20"
                                >
                                  <span className="font-medium text-ink-900 dark:text-ink-100">{c.contact.name}</span>
                                  <span className="text-xs text-ink-500">{c.status}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 dark:border-ink-800 dark:bg-ink-950/60">
                          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
                            <Activity className="h-4 w-4 text-violet-500" />
                            {t("teamsHub.teamPulse")}
                          </h2>
                          <ul className="space-y-2">
                            {overview.recentChannelActivity.length === 0 ? (
                              <li className="text-sm text-ink-500">{t("teamsHub.noActivity")}</li>
                            ) : (
                              overview.recentChannelActivity.map((m) => (
                                <li key={m.id} className="rounded-xl bg-ink-50/80 px-3 py-2 text-sm dark:bg-ink-900/40">
                                  <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                                    #{m.channel.name} · {m.author.name}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-ink-700 dark:text-ink-200">{m.body}</p>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {tab === "channels" && channelsOn && selected ? (
                    <div className="flex h-full min-h-[420px] gap-4">
                      <div className="flex w-56 shrink-0 flex-col rounded-2xl border border-ink-200 bg-white/90 dark:border-ink-800 dark:bg-ink-950/60">
                        {isAdmin ? (
                          <div className="border-b border-ink-100 p-2 dark:border-ink-800">
                            <button
                              type="button"
                              onClick={() => setChannelModal("create")}
                              className="btn-primary flex w-full items-center justify-center gap-1.5 text-xs"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {t("teamsHub.channelCreate")}
                            </button>
                          </div>
                        ) : null}
                        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                          {channels.map((ch) => (
                            <div
                              key={ch.id}
                              className={clsx(
                                "group flex items-start gap-1 rounded-xl transition",
                                activeChannelId === ch.id ? "bg-violet-500/15 ring-1 ring-violet-500/25" : "hover:bg-ink-100 dark:hover:bg-ink-900",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => setActiveChannelId(ch.id)}
                                className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                              >
                                <span className="block truncate font-semibold text-violet-900 dark:text-violet-100">#{ch.name}</span>
                                <span className="text-[10px] text-ink-500">{ch.messageCount} msgs</span>
                              </button>
                              {isAdmin ? (
                                <div className="flex shrink-0 flex-col gap-0.5 pr-1 pt-1 opacity-0 transition group-hover:opacity-100">
                                  <button
                                    type="button"
                                    title={t("teamsHub.channelEdit")}
                                    onClick={() => {
                                      setActiveChannelId(ch.id);
                                      setChannelModal("edit");
                                    }}
                                    className="rounded p-1 text-ink-500 hover:bg-white hover:text-violet-700 dark:hover:bg-ink-800"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title={t("teamsHub.channelDelete")}
                                    disabled={channelDeletingId === ch.id}
                                    onClick={() => void deleteChannel(ch.id)}
                                    className="rounded p-1 text-ink-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-ink-200 bg-white/90 dark:border-ink-800 dark:bg-ink-950/60">
                        <TeamChannelChat
                          teamId={selected.id}
                          channelId={activeChannelId}
                          currentUserId={user?.id}
                          dateLocale={dateLocale}
                          t={t}
                          onActivity={() => {
                            void loadChannels(selected.id);
                            void loadOverview(selected.id);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {tab === "workspace" && workspaceOn && selected ? (
                    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                      <div className="flex flex-col gap-1 rounded-2xl border border-ink-200 bg-white/90 p-2 dark:border-ink-800 dark:bg-ink-950/60">
                        {(
                          [
                            { id: "NOTE" as const, icon: StickyNote },
                            { id: "WIKI" as const, icon: BookOpen },
                            { id: "SNIPPET" as const, icon: Zap },
                            { id: "FILE_LINK" as const, icon: FileText },
                          ] as const
                        ).map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => setWorkspaceFilter(w.id)}
                            className={clsx(
                              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                              workspaceFilter === w.id
                                ? "bg-brand-500/15 text-brand-900 dark:text-brand-100"
                                : "text-ink-600 hover:bg-ink-100 dark:text-ink-300",
                            )}
                          >
                            <w.icon className="h-4 w-4" />
                            {t(`teamsHub.workspace.${w.id}`)}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-4">
                        <form
                          onSubmit={addWorkspaceItem}
                          className="rounded-2xl border border-dashed border-ink-200 bg-white/80 p-4 dark:border-ink-700 dark:bg-ink-950/40"
                        >
                          <input
                            value={wsTitle}
                            onChange={(e) => setWsTitle(e.target.value)}
                            placeholder={t("teamsHub.workspaceTitle")}
                            className="input-field mb-2 w-full"
                          />
                          {workspaceFilter === "FILE_LINK" ? (
                            <input
                              value={wsFileUrl}
                              onChange={(e) => setWsFileUrl(e.target.value)}
                              placeholder={t("teamsHub.fileUrl")}
                              className="input-field mb-2 w-full"
                            />
                          ) : (
                            <textarea
                              value={wsContent}
                              onChange={(e) => setWsContent(e.target.value)}
                              rows={3}
                              placeholder={t("teamsHub.workspaceBody")}
                              className="input-field mb-2 w-full resize-y"
                            />
                          )}
                          <button type="submit" className="btn-primary text-sm">
                            {t("common.add")}
                          </button>
                        </form>
                        <ul className="grid gap-3 sm:grid-cols-2">
                          {workspaceItems.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-ink-800 dark:bg-ink-950/60"
                            >
                              <p className="font-semibold text-ink-900 dark:text-ink-50">{item.title}</p>
                              {item.fileUrl ? (
                                <a href={item.fileUrl} target="_blank" rel="noreferrer" className="mt-2 text-sm text-brand-600 underline">
                                  {item.fileUrl}
                                </a>
                              ) : (
                                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-ink-600 dark:text-ink-300">
                                  {item.content}
                                </p>
                              )}
                              <p className="mt-2 text-[10px] text-ink-400">
                                {item.createdBy.name} ·{" "}
                                {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true, locale: dateLocale })}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="p-8 text-ink-500">{t("teams.empty")}</p>
            )}
          </main>

          {aiOn && selected ? (
            <aside className="hidden w-80 shrink-0 flex-col border-l border-ink-200/80 bg-white/70 dark:border-ink-800 dark:bg-ink-950/50 xl:flex">
              <div className="border-b border-ink-100 p-4 dark:border-ink-800">
                <h2 className="flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
                  <Sparkles className="h-4 w-4 text-violet-500" />
                  {t("teamsHub.aiTitle")}
                </h2>
                <p className="mt-1 text-xs text-ink-500">{t("teamsHub.aiHint")}</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {aiAnswer ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800 dark:text-ink-100">{aiAnswer}</p>
                ) : (
                  <p className="text-sm text-ink-500">{t("teamsHub.aiEmpty")}</p>
                )}
              </div>
              <div className="border-t border-ink-100 p-3 dark:border-ink-800">
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={3}
                  placeholder={t("teamsHub.aiPlaceholder")}
                  className="input-field mb-2 w-full resize-none text-sm"
                />
                <button type="button" disabled={aiBusy} onClick={() => void runAi()} className="btn-primary w-full text-sm">
                  {aiBusy ? t("teamsHub.aiBusy") : t("teamsHub.aiAsk")}
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <TeamCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
        placeholder={t("teamsHub.commandSearch")}
        emptyLabel={t("teamsHub.commandEmpty")}
      />

      <ChannelManageModal
        open={channelModal != null}
        mode={channelModal === "edit" ? "edit" : "create"}
        initial={
          channelModal === "edit" && activeChannel
            ? {
                name: activeChannel.name,
                description: activeChannel.description ?? "",
                kind: (activeChannel.kind as ChannelFormState["kind"]) ?? "GENERAL",
              }
            : undefined
        }
        busy={channelModalBusy}
        onClose={() => setChannelModal(null)}
        onSubmit={submitChannelModal}
      />
    </PageTransition>
  );
}
