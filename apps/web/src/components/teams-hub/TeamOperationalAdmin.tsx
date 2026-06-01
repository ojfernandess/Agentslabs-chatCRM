import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  CalendarClock,
  MessageSquare,
  Save,
  Settings2,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { PageTransition, motion } from "@/components/Motion";
import {
  BusinessHoursEditor,
  businessHoursToJson,
  defaultBusinessHours,
  parseBusinessHours,
  type BusinessHoursValue,
} from "./BusinessHoursEditor";

type TeamMemberRole = "TEAM_ADMIN" | "SUPERVISOR" | "MEMBER";

interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface TeamMemberRow {
  id: string;
  userId: string;
  role: TeamMemberRole;
  user: { id: string; name: string; email: string; role: string };
}

interface AdminTeam {
  id: string;
  name: string;
  description: string | null;
  businessHours?: unknown;
  members: TeamMemberRow[];
  _count: { members: number; conversations: number };
  unseenTransferCount?: number;
}

interface Props {
  /** When set, shows admin for a single team (hub mode). */
  teamId?: string;
  onBack?: () => void;
  /** Renders inside hub tabs (no full-page chrome). */
  embedded?: boolean;
  onTeamMutated?: () => void;
}

export function TeamOperationalAdmin({ teamId, onBack, embedded = false, onTeamMutated }: Props) {
  const { t } = useI18n();
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(teamId ?? null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bhEnabled, setBhEnabled] = useState(false);
  const [bhValue, setBhValue] = useState<BusinessHoursValue>(defaultBusinessHours());
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<TeamMemberRole>("MEMBER");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadTeams = useCallback(async () => {
    try {
      const res = await api.get<{ data: AdminTeam[] }>("/teams");
      setTeams(res.data);
      if (!teamId) {
        setSelectedId((prev) => {
          if (prev && res.data.some((x) => x.id === prev)) return prev;
          return res.data[0]?.id ?? null;
        });
      }
    } catch {
      setTeams([]);
    }
  }, [teamId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const users = await api.get<OrgUser[]>("/users");
        setOrgUsers(users);
        await loadTeams();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTeams]);

  const team = useMemo(() => {
    const id = teamId ?? selectedId;
    return teams.find((x) => x.id === id) ?? null;
  }, [teams, teamId, selectedId]);

  useEffect(() => {
    if (!team) return;
    setName(team.name);
    setDescription(team.description ?? "");
    const parsed = parseBusinessHours(team.businessHours);
    if (parsed) {
      setBhEnabled(true);
      setBhValue(parsed);
    } else {
      setBhEnabled(false);
      setBhValue(defaultBusinessHours());
    }
  }, [team?.id, team?.name, team?.description, team?.businessHours]);

  const roleLabel = (role: TeamMemberRole) => t(`teams.roles.${role}`);

  const dirty =
    team != null &&
    (name.trim() !== team.name ||
      (description.trim() || "") !== (team.description ?? "") ||
      (bhEnabled
        ? JSON.stringify(businessHoursToJson(bhValue)) !==
          JSON.stringify(team.businessHours ?? null)
        : team.businessHours != null));

  const handleSave = async () => {
    if (!team || !name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        businessHours: bhEnabled ? businessHoursToJson(bhValue) : null,
      };
      await api.patch(`/teams/${team.id}`, body);
      await loadTeams();
      onTeamMutated?.();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!team) return;
    const ok = window.confirm(
      `${t("teams.deleteTeam")}: "${team.name}"?\n\n${t("teams.memberCount")}: ${team._count.members}\n${t("teams.conversations")}: ${team._count.conversations}\n\n${t("teams.deleteConfirmHint")}`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await api.delete(`/teams/${team.id}`);
      await loadTeams();
      onTeamMutated?.();
      if (teamId && onBack) onBack();
    } finally {
      setDeleting(false);
    }
  };

  const handleAddMember = async () => {
    if (!team || !addUserId) return;
    await api.post(`/teams/${team.id}/members`, { userId: addUserId, role: addRole });
    setAddUserId("");
    await loadTeams();
    onTeamMutated?.();
  };

  const handleRoleChange = async (userId: string, role: TeamMemberRole) => {
    if (!team) return;
    await api.patch(`/teams/${team.id}/members/${userId}`, { role });
    await loadTeams();
    onTeamMutated?.();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!team) return;
    await api.delete(`/teams/${team.id}/members/${userId}`);
    await loadTeams();
    onTeamMutated?.();
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!team) {
    return <p className="p-8 text-ink-500">{t("teams.empty")}</p>;
  }

  const memberIds = new Set(team.members.map((m) => m.userId));
  const candidates = orgUsers.filter((u) => !memberIds.has(u.id));

  const inner = (
    <>
        <header
          className={clsx(
            "mb-6 flex flex-wrap items-start justify-between gap-4",
            embedded && "mb-4",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {onBack && !embedded ? (
              <button
                type="button"
                onClick={onBack}
                className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 shadow-sm hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
                aria-label={t("teamsHub.backToHub")}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <div className="min-w-0">
              {!embedded ? (
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                  {t("teamsHub.adminTitle")}
                </p>
              ) : null}
              <h1
                className={clsx(
                  "truncate font-bold tracking-tight text-ink-900 dark:text-ink-50",
                  embedded ? "text-lg" : "text-2xl",
                )}
              >
                {team.name}
              </h1>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("teamsHub.adminSubtitle")}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!dirty || saving || deleting || !name.trim()}
              onClick={() => void handleSave()}
              className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("teams.saving") : t("teams.saveDetails")}
            </button>
            <button
              type="button"
              disabled={deleting || saving}
              onClick={() => void handleDelete()}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? t("teams.deleting") : t("teams.deleteTeam")}
            </button>
          </div>
        </header>

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            { icon: UsersRound, label: t("teams.memberCount"), value: team._count.members, tone: "violet" },
            { icon: MessageSquare, label: t("teams.conversations"), value: team._count.conversations, tone: "brand" },
            {
              icon: CalendarClock,
              label: t("teams.businessHours.status"),
              value: bhEnabled ? t("teams.businessHours.enabled") : t("teams.businessHours.disabled"),
              tone: "emerald",
            },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-ink-200/80 bg-white/90 p-4 shadow-sm dark:border-ink-800 dark:bg-ink-950/60"
            >
              <stat.icon className="mb-2 h-5 w-5 text-brand-500" />
              <p className="text-xs font-medium text-ink-500">{stat.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{stat.value}</p>
            </motion.div>
          ))}
        </div>

        {!teamId && teams.length > 1 ? (
          <div className="mb-6 flex flex-wrap gap-2">
            {teams.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={clsx(
                  "rounded-xl px-3 py-2 text-sm font-medium transition",
                  row.id === team.id
                    ? "bg-brand-500 text-white shadow-sm"
                    : "border border-ink-200 bg-white text-ink-700 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200",
                )}
              >
                {row.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <section className="space-y-6">
            <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-ink-800 dark:bg-ink-950/60">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
                <Settings2 className="h-4 w-4 text-violet-500" />
                {t("teams.teamDetails")}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-600 dark:text-ink-400">{t("teams.name")}</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input-field w-full"
                    placeholder={t("teams.namePlaceholder")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-600 dark:text-ink-400">
                    {t("teams.description")}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="input-field w-full resize-y"
                    placeholder={t("teams.descriptionPlaceholder")}
                  />
                </div>
              </div>
            </div>

            <BusinessHoursEditor
              enabled={bhEnabled}
              value={bhValue}
              onEnabledChange={setBhEnabled}
              onChange={setBhValue}
            />
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-ink-800 dark:bg-ink-950/60">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
                <UserPlus className="h-4 w-4 text-brand-500" />
                {t("teams.addMember")}
              </h2>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void handleAddMember();
                }}
                className="space-y-3"
              >
                <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="input-field w-full text-sm">
                  <option value="">{t("teams.selectUser")}</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as TeamMemberRole)}
                  className="input-field w-full text-sm"
                >
                  {(["TEAM_ADMIN", "SUPERVISOR", "MEMBER"] as const).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={!addUserId} className="btn-primary w-full text-sm disabled:opacity-50">
                  {t("common.add")}
                </button>
              </form>
            </div>

            <div className="rounded-2xl border border-ink-200/80 bg-white/90 shadow-sm dark:border-ink-800 dark:bg-ink-950/60">
              <h2 className="border-b border-ink-100 px-5 py-3 text-sm font-bold text-ink-900 dark:border-ink-800 dark:text-ink-50">
                {t("teams.members")} ({team.members.length})
              </h2>
              <ul className="max-h-[420px] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
                {team.members.map((m) => (
                  <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-900 dark:text-ink-100">{m.user.name}</p>
                      <p className="truncate text-xs text-ink-500">{m.user.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => void handleRoleChange(m.userId, e.target.value as TeamMemberRole)}
                        className="input-field w-36 text-xs"
                      >
                        {(["TEAM_ADMIN", "SUPERVISOR", "MEMBER"] as const).map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleRemoveMember(m.userId)}
                        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                      >
                        {t("teams.removeMember")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
    </>
  );

  if (embedded) {
    return <div className="mx-auto max-w-6xl">{inner}</div>;
  }

  return (
    <PageTransition>
      <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-violet-50/20 p-4 dark:from-ink-950 dark:via-ink-950 dark:to-violet-950/10 lg:p-6">
        {inner}
      </div>
    </PageTransition>
  );
}
