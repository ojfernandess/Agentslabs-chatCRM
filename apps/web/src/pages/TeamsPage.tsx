import { useState, useEffect, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { UsersRound, ChevronDown, ChevronRight } from "lucide-react";

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
  members: TeamMemberRow[];
  _count: { members: number; conversations: number };
}

export function TeamsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addUserId, setAddUserId] = useState<Record<string, string>>({});
  const [addRole, setAddRole] = useState<Record<string, TeamMemberRole>>({});

  const loadTeams = async () => {
    try {
      const res = await api.get<{ data: AdminTeam[] }>("/teams");
      setTeams(res.data);
    } catch {
      setTeams([]);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const users = await api.get<OrgUser[]>("/users");
        setOrgUsers(users);
        await loadTeams();
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const roleLabel = (role: TeamMemberRole) => t(`teams.roles.${role}`);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.post("/teams", { name });
      setNewTeamName("");
      await loadTeams();
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  const handleAddMember = async (teamId: string) => {
    const userId = addUserId[teamId];
    const role = addRole[teamId] ?? "MEMBER";
    if (!userId) return;
    try {
      await api.post(`/teams/${teamId}/members`, { userId, role });
      setAddUserId((p) => ({ ...p, [teamId]: "" }));
      await loadTeams();
    } catch {
      /* ignore */
    }
  };

  const handleRoleChange = async (teamId: string, userId: string, role: TeamMemberRole) => {
    try {
      await api.patch(`/teams/${teamId}/members/${userId}`, { role });
      await loadTeams();
    } catch {
      /* ignore */
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    try {
      await api.delete(`/teams/${teamId}/members/${userId}`);
      await loadTeams();
    } catch {
      /* ignore */
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-ink-600">{t("common.adminRequired")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="p-6 lg:p-8">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <div className="mb-2 flex items-center gap-2 text-brand-600">
              <UsersRound className="h-6 w-6" />
              <span className="text-sm font-medium uppercase tracking-wide">{t("nav.teams")}</span>
            </div>
            <h1 className="text-2xl font-bold text-ink-900">{t("teams.title")}</h1>
            <p className="mt-1 text-ink-600">{t("teams.subtitle")}</p>
          </div>
        </motion.header>

        <form onSubmit={handleCreate} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-ink-200 bg-white p-4 shadow-sm">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="new-team-name" className="mb-1 block text-xs font-medium text-ink-600">
              {t("teams.name")}
            </label>
            <input
              id="new-team-name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder={t("teams.namePlaceholder")}
              className="input w-full"
            />
          </div>
          <button type="submit" disabled={creating || !newTeamName.trim()} className="btn-primary">
            {t("teams.create")}
          </button>
        </form>

        <motion.ul
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-3"
        >
          {teams.length === 0 ? (
            <p className="text-ink-500">{t("teams.empty")}</p>
          ) : (
            teams.map((team) => {
              const open = expanded[team.id];
              const memberIds = new Set(team.members.map((m) => m.userId));
              const candidates = orgUsers.filter((u) => !memberIds.has(u.id));

              return (
                <motion.li
                  key={team.id}
                  variants={staggerItem}
                  className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(team.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50"
                  >
                    {open ? <ChevronDown className="h-5 w-5 shrink-0 text-ink-400" /> : <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-900">{team.name}</p>
                      <p className="text-xs text-ink-500">
                        {t("teams.memberCount")}: {team._count.members} · {t("teams.conversations")}: {team._count.conversations}
                      </p>
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t border-ink-100 px-4 py-3 space-y-4 bg-ink-50/50">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[180px] flex-1">
                          <label className="mb-1 block text-xs text-ink-600">{t("teams.addMember")}</label>
                          <select
                            value={addUserId[team.id] ?? ""}
                            onChange={(e) => setAddUserId((p) => ({ ...p, [team.id]: e.target.value }))}
                            className="input w-full"
                          >
                            <option value="">{t("teams.selectUser")}</option>
                            {candidates.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name} ({u.email})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-40">
                          <label className="mb-1 block text-xs text-ink-600">{t("teams.role")}</label>
                          <select
                            value={addRole[team.id] ?? "MEMBER"}
                            onChange={(e) =>
                              setAddRole((p) => ({ ...p, [team.id]: e.target.value as TeamMemberRole }))
                            }
                            className="input w-full"
                          >
                            {(["TEAM_ADMIN", "SUPERVISOR", "MEMBER"] as const).map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddMember(team.id)}
                          disabled={!addUserId[team.id]}
                          className="btn-secondary text-sm"
                        >
                          {t("common.add")}
                        </button>
                      </div>
                      <ul className="divide-y divide-ink-100 rounded border border-ink-100 bg-white">
                        {team.members.map((m) => (
                          <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink-900">{m.user.name}</p>
                              <p className="text-xs text-ink-500">{m.user.email}</p>
                            </div>
                            <select
                              value={m.role}
                              onChange={(e) => handleRoleChange(team.id, m.userId, e.target.value as TeamMemberRole)}
                              className="input w-44 text-xs"
                            >
                              {(["TEAM_ADMIN", "SUPERVISOR", "MEMBER"] as const).map((r) => (
                                <option key={r} value={r}>
                                  {roleLabel(r)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(team.id, m.userId)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              {t("teams.removeMember")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </motion.li>
              );
            })
          )}
        </motion.ul>
      </div>
    </PageTransition>
  );
}
