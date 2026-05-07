import { useState, useEffect, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { UsersRound, ChevronDown, ChevronRight, Trash2 } from "lucide-react";

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
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; description: string; businessHoursText: string }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const getDraft = (team: AdminTeam) =>
    drafts[team.id] ?? {
      name: team.name,
      description: team.description ?? "",
      businessHoursText:
        team.businessHours != null ? JSON.stringify(team.businessHours as object, null, 2) : "",
    };

  const canonBhText = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed === "") return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  };

  const setDraftField = (
    teamId: string,
    team: AdminTeam,
    field: "name" | "description" | "businessHoursText",
    value: string,
  ) => {
    const cur = getDraft(team);
    setDrafts((p) => ({ ...p, [teamId]: { ...cur, [field]: value } }));
  };

  const handleSaveTeamDetails = async (team: AdminTeam) => {
    const d = getDraft(team);
    const name = d.name.trim();
    if (!name) return;
    setSavingId(team.id);
    try {
      const desc = d.description.trim();
      const origBhCanon =
        team.businessHours != null ? canonBhText(JSON.stringify(team.businessHours as object)) : "";
      const body: Record<string, unknown> = {
        name,
        description: desc === "" ? null : desc,
      };
      if (canonBhText(d.businessHoursText) !== origBhCanon) {
        const rawBh = d.businessHoursText.trim();
        if (rawBh === "") {
          body.businessHours = null;
        } else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(rawBh);
          } catch {
            window.alert(t("teams.businessHoursInvalid"));
            setSavingId(null);
            return;
          }
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            window.alert(t("teams.businessHoursInvalid"));
            setSavingId(null);
            return;
          }
          body.businessHours = parsed as Record<string, unknown>;
        }
      }
      await api.patch(`/teams/${team.id}`, body);
      await loadTeams();
      setDrafts((p) => {
        const next = { ...p };
        delete next[team.id];
        return next;
      });
    } catch {
      /* ignore */
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteTeam = async (team: AdminTeam) => {
    const ok = window.confirm(
      `${t("teams.deleteTeam")}: "${team.name}"?\n\n${t("teams.memberCount")}: ${team._count.members}\n${t("teams.conversations")}: ${team._count.conversations}\n\n${t("teams.deleteConfirmHint")}`,
    );
    if (!ok) return;
    setDeletingId(team.id);
    try {
      await api.delete(`/teams/${team.id}`);
      setExpanded((p) => {
        const next = { ...p };
        delete next[team.id];
        return next;
      });
      setDrafts((p) => {
        const next = { ...p };
        delete next[team.id];
        return next;
      });
      await loadTeams();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const detailsDirty = (team: AdminTeam) => {
    const d = getDraft(team);
    const origBhCanon =
      team.businessHours != null ? canonBhText(JSON.stringify(team.businessHours as object)) : "";
    return (
      d.name.trim() !== team.name ||
      (d.description.trim() || "") !== (team.description ?? "") ||
      canonBhText(d.businessHoursText) !== origBhCanon
    );
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
                    <div className="border-t border-ink-100 space-y-4 bg-ink-50/50 px-4 py-3">
                      <div className="rounded-lg border border-ink-200 bg-white p-3 shadow-sm">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                          {t("teams.teamDetails")}
                        </p>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <div className="min-w-0 flex-1 space-y-2">
                            <input
                              value={getDraft(team).name}
                              onChange={(e) => setDraftField(team.id, team, "name", e.target.value)}
                              className="input w-full text-sm font-medium"
                              aria-label={t("teams.name")}
                            />
                            <textarea
                              value={getDraft(team).description}
                              onChange={(e) => setDraftField(team.id, team, "description", e.target.value)}
                              placeholder={t("teams.descriptionPlaceholder")}
                              rows={2}
                              className="input w-full resize-y text-sm"
                              aria-label={t("teams.description")}
                            />
                            <div>
                              <label
                                htmlFor={`bh-${team.id}`}
                                className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400"
                              >
                                {t("teams.businessHoursLabel")}
                              </label>
                              <p className="mb-1 text-[11px] leading-snug text-ink-500">{t("teams.businessHoursHint")}</p>
                              <textarea
                                id={`bh-${team.id}`}
                                value={getDraft(team).businessHoursText}
                                onChange={(e) => setDraftField(team.id, team, "businessHoursText", e.target.value)}
                                placeholder={t("teams.businessHoursPlaceholder")}
                                rows={6}
                                spellCheck={false}
                                className="input w-full resize-y font-mono text-xs"
                              />
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                            <button
                              type="button"
                              disabled={
                                savingId === team.id ||
                                deletingId !== null ||
                                !getDraft(team).name.trim() ||
                                !detailsDirty(team)
                              }
                              onClick={() => void handleSaveTeamDetails(team)}
                              className="btn-primary whitespace-nowrap text-sm disabled:opacity-50"
                            >
                              {savingId === team.id ? t("teams.saving") : t("teams.saveDetails")}
                            </button>
                            <button
                              type="button"
                              disabled={deletingId !== null || savingId !== null}
                              onClick={() => void handleDeleteTeam(team)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
                            >
                              <Trash2 className="h-4 w-4" />
                              {deletingId === team.id ? t("teams.deleting") : t("teams.deleteTeam")}
                            </button>
                          </div>
                        </div>
                      </div>
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
