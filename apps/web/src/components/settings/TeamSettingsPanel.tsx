import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2, Users, Mail } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TeamInviteSendForm } from "./TeamInviteSendForm";
import { TeamInvitesList } from "./TeamInvitesList";

type TeamUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  createdAt: string;
};

type TeamTab = "members" | "invites";

type TeamSettingsPanelProps = {
  isAdmin: boolean;
  currentUserId: string | undefined;
};

export function TeamSettingsPanel({ isAdmin, currentUserId }: TeamSettingsPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TeamTab>("members");
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [userFormError, setUserFormError] = useState("");
  const [userFormSubmitting, setUserFormSubmitting] = useState(false);
  const [invitesReloadKey, setInvitesReloadKey] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<TeamUser | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) {
      setTeamUsers([]);
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    try {
      const users = await api.get<TeamUser[]>("/users");
      setTeamUsers(Array.isArray(users) ? users : []);
    } catch {
      setTeamUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    setUserFormError("");
    setUserFormSubmitting(true);
    try {
      await api.post<TeamUser>("/users", {
        name: newUserName,
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole,
      });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("AGENT");
      await loadUsers();
    } catch (err) {
      setUserFormError(err instanceof ApiError ? err.message : t("settings.teamAddUserError"));
    } finally {
      setUserFormSubmitting(false);
    }
  };

  const confirmRemoveUser = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await api.delete(`/users/${removeTarget.id}`);
      setRemoveTarget(null);
      await loadUsers();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : t("settings.teamRemoveUserError"));
    } finally {
      setRemoveBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        {t("common.adminRequired")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-ink-200 p-0.5 dark:border-ink-700">
        <button
          type="button"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "members"
              ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900"
              : "text-ink-600 hover:bg-ink-50 dark:text-ink-400 dark:hover:bg-ink-800",
          )}
          onClick={() => setTab("members")}
        >
          <Users className="h-4 w-4" />
          {t("settings.teamTabMembers")}
        </button>
        <button
          type="button"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "invites"
              ? "bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900"
              : "text-ink-600 hover:bg-ink-50 dark:text-ink-400 dark:hover:bg-ink-800",
          )}
          onClick={() => setTab("invites")}
        >
          <Mail className="h-4 w-4" />
          {t("settings.teamTabInvites")}
        </button>
      </div>

      {tab === "members" ? (
        <>
          <TeamInviteSendForm
            onSent={() => {
              setInvitesReloadKey((k) => k + 1);
              setTab("invites");
            }}
          />

          <p className="text-sm text-ink-500 dark:text-ink-400">{t("settings.teamManualSubtitle")}</p>

          {usersLoading ? (
            <p className="text-sm text-ink-500">{t("common.loading")}</p>
          ) : teamUsers.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-ink-200/80 dark:border-white/10">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200/80 bg-ink-50 text-xs font-medium uppercase tracking-wide text-ink-500 dark:border-white/10 dark:bg-white/5">
                    <th className="px-4 py-2">{t("settings.teamColName")}</th>
                    <th className="px-4 py-2">{t("settings.teamColEmail")}</th>
                    <th className="px-4 py-2">{t("settings.teamColRole")}</th>
                    <th className="px-4 py-2">{t("settings.teamColAdded")}</th>
                    <th className="px-4 py-2 text-right">{t("settings.tagsColActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                  {teamUsers.map((u) => {
                    const isSelf = u.id === currentUserId;
                    return (
                      <tr key={u.id} className="bg-white dark:bg-transparent">
                        <td className="px-4 py-2.5 font-medium text-ink-900 dark:text-ink-100">{u.name}</td>
                        <td className="px-4 py-2.5 text-ink-600 dark:text-ink-400">{u.email}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={
                              u.role === "ADMIN"
                                ? "rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                                : "rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700 dark:bg-white/10 dark:text-ink-300"
                            }
                          >
                            {u.role === "ADMIN" ? t("settings.invitesRoleAdmin") : t("settings.invitesRoleAgent")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-ink-500 dark:text-ink-400">
                          {new Date(u.createdAt).toLocaleDateString("pt-BR", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isSelf ? (
                            <span className="text-xs text-ink-400">{t("settings.teamYou")}</span>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                              onClick={() => {
                                setRemoveError(null);
                                setRemoveTarget(u);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t("settings.teamRemoveUser")}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-500">{t("settings.teamUsersEmpty")}</p>
          )}

          <form onSubmit={(e) => void handleAddUser(e)} className="space-y-4 border-t border-ink-100 pt-4 dark:border-white/10">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{t("settings.teamAddUserTitle")}</h3>
            {userFormError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{userFormError}</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.teamColName")}</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  required
                  autoComplete="name"
                  className="mt-1 block w-full input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.teamColEmail")}</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="mt-1 block w-full input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.teamColRole")}</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as "ADMIN" | "AGENT")}
                  className="mt-1 block w-full input-field"
                >
                  <option value="AGENT">{t("settings.invitesRoleAgent")}</option>
                  <option value="ADMIN">{t("settings.invitesRoleAdmin")}</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                  {t("settings.teamInitialPassword")}
                </label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder={t("settings.teamPasswordHint")}
                  className="mt-1 block w-full input-field"
                />
              </div>
            </div>
            <button type="submit" disabled={userFormSubmitting} className="btn-primary">
              {userFormSubmitting ? t("common.saving") : t("settings.teamAddUserSubmit")}
            </button>
          </form>
        </>
      ) : (
        <div className="rounded-xl border border-ink-200/80 p-4 dark:border-white/10">
          <h3 className="mb-1 text-sm font-semibold text-ink-900 dark:text-ink-100">{t("settings.invitesListTitle")}</h3>
          <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">{t("settings.teamTabInvitesHelp")}</p>
          <TeamInvitesList key={invitesReloadKey} />
        </div>
      )}

      <ConfirmDialog
        open={removeTarget != null}
        title={t("settings.teamRemoveUserTitle")}
        message={
          removeTarget
            ? t("settings.teamRemoveUserConfirm").replace("{name}", removeTarget.name)
            : ""
        }
        confirmLabel={t("settings.teamRemoveUser")}
        variant="danger"
        loading={removeBusy}
        error={removeError}
        onConfirm={() => void confirmRemoveUser()}
        onCancel={() => {
          if (!removeBusy) setRemoveTarget(null);
        }}
      />
    </div>
  );
}
