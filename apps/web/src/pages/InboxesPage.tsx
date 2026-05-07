import { useState, useEffect, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition } from "@/components/Motion";
import { Inbox, ChevronDown, ChevronRight, Trash2 } from "lucide-react";

type OrgUser = { id: string; name: string; email: string; role: string };

type InboxMemberRow = {
  id: string;
  userId: string;
  user: OrgUser;
};

type InboxRow = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  members?: InboxMemberRow[];
  _count: { members: number; conversations: number };
};

export function InboxesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addUserId, setAddUserId] = useState<Record<string, string>>({});
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.get<{ data: InboxRow[] }>("/inboxes");
      setRows(res.data);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      void (async () => {
        await load();
        setLoading(false);
      })();
      return;
    }
    (async () => {
      try {
        const users = await api.get<OrgUser[]>("/users");
        setOrgUsers(users);
        await load();
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || !isAdmin) return;
    setCreating(true);
    try {
      await api.post("/inboxes", {
        name,
        description: newDescription.trim() || null,
        isDefault: newIsDefault || undefined,
      });
      setNewName("");
      setNewDescription("");
      setNewIsDefault(false);
      await load();
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  const handleAddMember = async (inboxId: string) => {
    if (!isAdmin) return;
    const uid = addUserId[inboxId];
    if (!uid) return;
    try {
      await api.post(`/inboxes/${inboxId}/members`, { userId: uid });
      setAddUserId((prev) => ({ ...prev, [inboxId]: "" }));
      await load();
    } catch {
      /* ignore */
    }
  };

  const handleRemoveMember = async (inboxId: string, userId: string) => {
    if (!isAdmin) return;
    try {
      await api.delete(`/inboxes/${inboxId}/members/${userId}`);
      await load();
    } catch {
      /* ignore */
    }
  };

  const handleSetDefault = async (inboxId: string) => {
    if (!isAdmin) return;
    setPatchingId(inboxId);
    try {
      await api.patch(`/inboxes/${inboxId}`, { isDefault: true });
      await load();
    } catch {
      /* ignore */
    } finally {
      setPatchingId(null);
    }
  };

  return (
    <PageTransition>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-ink-50">
            <Inbox className="h-7 w-7 text-brand-600 dark:text-brand-400" />
            {t("inboxesPage.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-ink-400">{t("inboxesPage.subtitle")}</p>
          {!isAdmin ? (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300/90">{t("inboxesPage.readOnlyHint")}</p>
          ) : null}
        </div>

        {isAdmin ? (
          <form
            onSubmit={handleCreate}
            className="mb-8 rounded-xl border border-gray-200 bg-white p-4 dark:border-ink-700 dark:bg-[#161f2c]/80"
          >
            <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-ink-100">{t("inboxesPage.create")}</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-[180px] flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                  {t("inboxesPage.name")}
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("inboxesPage.namePlaceholder")}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                />
              </div>
              <div className="min-w-[200px] flex-[2]">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                  {t("inboxesPage.description")}
                </label>
                <input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={t("inboxesPage.descriptionPlaceholder")}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-ink-200">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {t("inboxesPage.setDefault")}
              </label>
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
              >
                {creating ? t("inboxesPage.creating") : t("common.add")}
              </button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-ink-400">{t("inboxesPage.empty")}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const open = !!expanded[row.id];
              const members = row.members ?? [];
              return (
                <div
                  key={row.id}
                  className="rounded-xl border border-gray-200 bg-white dark:border-ink-700 dark:bg-[#161f2c]/80"
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-ink-50">{row.name}</span>
                        {row.isDefault ? (
                          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
                            {t("inboxesPage.defaultBadge")}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-ink-400">
                        {t("inboxesPage.memberCount")}: {row._count.members} · {t("inboxesPage.conversations")}:{" "}
                        {row._count.conversations}
                      </p>
                    </div>
                    {isAdmin && !row.isDefault ? (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void handleSetDefault(row.id);
                        }}
                        disabled={patchingId === row.id}
                        className="btn-secondary shrink-0 px-2 py-1 text-xs"
                      >
                        {patchingId === row.id ? t("inboxesPage.saving") : t("inboxesPage.setDefault")}
                      </button>
                    ) : null}
                  </button>
                  {open && isAdmin && members.length >= 0 ? (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-2 dark:border-ink-700">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-ink-500">
                        {t("inboxesPage.members")}
                      </h3>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <select
                          value={addUserId[row.id] ?? ""}
                          onChange={(e) => setAddUserId((p) => ({ ...p, [row.id]: e.target.value }))}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                        >
                          <option value="">{t("inboxesPage.selectUser")}</option>
                          {orgUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.email})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleAddMember(row.id)}
                          className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-medium text-white dark:bg-ink-600"
                        >
                          {t("inboxesPage.addMember")}
                        </button>
                      </div>
                      <ul className="space-y-1">
                        {members.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-ink-900/60"
                          >
                            <span className="text-gray-800 dark:text-ink-100">
                              {m.user.name} <span className="text-gray-500 dark:text-ink-400">({m.user.email})</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveMember(row.id, m.userId)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400"
                              title={t("inboxesPage.removeMember")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
