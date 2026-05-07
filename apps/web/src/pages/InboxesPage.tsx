import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition } from "@/components/Motion";
import { Inbox, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { InboxCreateWizard, INBOX_CHANNEL_ORDER } from "@/components/InboxCreateWizard";

function outboundWebhookFromConfig(cfg: unknown): string {
  if (!cfg || typeof cfg !== "object") return "";
  const u = (cfg as { outboundWebhookUrl?: unknown }).outboundWebhookUrl;
  return typeof u === "string" ? u : "";
}

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
  channelType: string;
  isDefault: boolean;
  ingestToken?: string | null;
  channelConfig?: unknown | null;
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [addUserId, setAddUserId] = useState<Record<string, string>>({});
  const [patchingId, setPatchingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSavingId, setEditSavingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editChannel, setEditChannel] = useState<string>("WHATSAPP");
  const [editWebhook, setEditWebhook] = useState("");

  const basePublicInbox =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1/public/inbox` : "";

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const handleRotateIngest = async (inboxId: string) => {
    if (!isAdmin) return;
    setPatchingId(inboxId);
    try {
      await api.post(`/inboxes/${inboxId}/rotate-ingest-token`);
      await load();
    } catch {
      /* ignore */
    } finally {
      setPatchingId(null);
    }
  };

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

  const channelShort = (ct: string) => {
    const key = `inboxesPage.channelTypes.${ct}`;
    const label = t(key);
    return label === key ? ct : label;
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

  const startEdit = (row: InboxRow) => {
    setExpanded((p) => ({ ...p, [row.id]: true }));
    setEditingId(row.id);
    setEditName(row.name);
    setEditDescription(row.description ?? "");
    setEditChannel(row.channelType);
    setEditWebhook(outboundWebhookFromConfig(row.channelConfig));
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (inboxId: string) => {
    if (!isAdmin) return;
    const n = editName.trim();
    if (!n) return;
    setEditSavingId(inboxId);
    try {
      const row = rows.find((r) => r.id === inboxId);
      const wh = editWebhook.trim();
      const prev =
        row?.channelConfig &&
        typeof row.channelConfig === "object" &&
        !Array.isArray(row.channelConfig)
          ? { ...(row.channelConfig as Record<string, unknown>) }
          : {};
      if (wh) prev.outboundWebhookUrl = wh;
      else delete prev.outboundWebhookUrl;
      const channelConfigPayload = Object.keys(prev).length > 0 ? prev : null;

      await api.patch(`/inboxes/${inboxId}`, {
        name: n,
        description: editDescription.trim() || null,
        channelType: editChannel,
        channelConfig: channelConfigPayload,
      });
      setEditingId(null);
      await load();
    } catch {
      window.alert(t("inboxesPage.editSaveFailed"));
    } finally {
      setEditSavingId(null);
    }
  };

  const handleDeleteInbox = async (row: InboxRow) => {
    if (!isAdmin) return;
    const msg = t("inboxesPage.deleteConfirm").replace("{name}", row.name);
    if (!window.confirm(msg)) return;
    setPatchingId(row.id);
    try {
      await api.delete(`/inboxes/${row.id}`);
      setExpanded((p) => {
        const next = { ...p };
        delete next[row.id];
        return next;
      });
      setEditingId((e) => (e === row.id ? null : e));
      await load();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 400
          ? err.message
          : t("inboxesPage.deleteFailed");
      window.alert(message);
    } finally {
      setPatchingId(null);
    }
  };

  return (
    <PageTransition>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
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
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-500"
            >
              {t("inboxesPage.create")}
            </button>
          ) : null}
        </div>

        <InboxCreateWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onCreated={() => void load()}
          orgUsers={orgUsers}
        />

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
                  <div className="flex w-full items-stretch gap-2 px-2 py-2 sm:px-4 sm:py-3">
                    <button
                      type="button"
                      onClick={() => toggle(row.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-ink-50">{row.name}</span>
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950/45 dark:text-violet-200">
                            {channelShort(row.channelType)}
                          </span>
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
                    </button>
                    {isAdmin ? (
                      <div className="flex shrink-0 flex-col items-end justify-center gap-1 sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs"
                          title={t("common.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">{t("common.edit")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteInbox(row)}
                          disabled={rows.length <= 1 || patchingId === row.id}
                          className="flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                          title={rows.length <= 1 ? t("inboxesPage.deleteOnlyInbox") : t("inboxesPage.deleteInbox")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">{t("common.delete")}</span>
                        </button>
                        {!row.isDefault ? (
                          <button
                            type="button"
                            onClick={() => void handleSetDefault(row.id)}
                            disabled={patchingId === row.id}
                            className="btn-secondary shrink-0 px-2 py-1 text-xs"
                          >
                            {patchingId === row.id ? t("inboxesPage.saving") : t("inboxesPage.setDefault")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {open && isAdmin && members.length >= 0 ? (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-2 dark:border-ink-700">
                      {editingId === row.id ? (
                        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900/50 dark:bg-brand-950/20">
                          <h3 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">
                            {t("inboxesPage.editSection")}
                          </h3>
                          <p className="mb-3 text-xs text-gray-600 dark:text-ink-400">{t("inboxesPage.editDetails")}</p>
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                            {t("inboxesPage.name")}
                          </label>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="mb-3 w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                          />
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                            {t("inboxesPage.description")}
                          </label>
                          <input
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="mb-3 w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                          />
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                            {t("inboxesPage.channelLabel")}
                          </label>
                          <select
                            value={editChannel}
                            onChange={(e) => setEditChannel(e.target.value)}
                            className="mb-3 w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                          >
                            {INBOX_CHANNEL_ORDER.map((ch) => (
                              <option key={ch} value={ch}>
                                {channelShort(ch)}
                              </option>
                            ))}
                          </select>
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                            {t("inboxesPage.outboundWebhookField")}
                          </label>
                          <input
                            type="url"
                            value={editWebhook}
                            onChange={(e) => setEditWebhook(e.target.value)}
                            placeholder="https://"
                            className="mb-3 w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={editSavingId === row.id || !editName.trim()}
                              onClick={() => void saveEdit(row.id)}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                            >
                              {editSavingId === row.id ? t("common.saving") : t("common.save")}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-ink-600"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-ink-600 dark:bg-ink-900/40">
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-ink-400">
                          {t("inboxesPage.ingestTitle")}
                        </h3>
                        <p className="mb-2 text-xs text-gray-500 dark:text-ink-500">{t("inboxesPage.ingestPathsIntro")}</p>
                        {row.channelType === "WHATSAPP" ? (
                          <p className="mb-2 text-xs text-amber-800/90 dark:text-amber-200/85">
                            {t("inboxesPage.wizard.ingestNoteWhatsApp")}
                          </p>
                        ) : null}
                        {row.ingestToken && basePublicInbox ? (
                          <ul className="mb-2 space-y-2 text-xs">
                            <li className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <span className="font-medium text-gray-700 dark:text-ink-200">POST JSON</span>
                              <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
                                <code className="max-w-[min(100%,28rem)] truncate rounded bg-white px-2 py-0.5 dark:bg-ink-950">
                                  {`${basePublicInbox}/${row.ingestToken}/inbound`}
                                </code>
                                <button
                                  type="button"
                                  className="shrink-0 text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={() => void copyUrl(`${basePublicInbox}/${row.ingestToken}/inbound`)}
                                >
                                  {t("inboxesPage.wizard.ingestCopy")}
                                </button>
                              </div>
                            </li>
                            <li className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <span className="font-medium text-gray-700 dark:text-ink-200">Telegram</span>
                              <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
                                <code className="max-w-[min(100%,28rem)] truncate rounded bg-white px-2 py-0.5 dark:bg-ink-950">
                                  {`${basePublicInbox}/${row.ingestToken}/telegram`}
                                </code>
                                <button
                                  type="button"
                                  className="shrink-0 text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={() => void copyUrl(`${basePublicInbox}/${row.ingestToken}/telegram`)}
                                >
                                  {t("inboxesPage.wizard.ingestCopy")}
                                </button>
                              </div>
                            </li>
                            <li className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <span className="font-medium text-gray-700 dark:text-ink-200">Twilio</span>
                              <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
                                <code className="max-w-[min(100%,28rem)] truncate rounded bg-white px-2 py-0.5 dark:bg-ink-950">
                                  {`${basePublicInbox}/${row.ingestToken}/twilio`}
                                </code>
                                <button
                                  type="button"
                                  className="shrink-0 text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={() => void copyUrl(`${basePublicInbox}/${row.ingestToken}/twilio`)}
                                >
                                  {t("inboxesPage.wizard.ingestCopy")}
                                </button>
                              </div>
                            </li>
                          </ul>
                        ) : (
                          <p className="mb-2 text-xs text-gray-500 dark:text-ink-500">—</p>
                        )}
                        <button
                          type="button"
                          disabled={patchingId === row.id}
                          className="mb-2 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:border-ink-600 dark:text-ink-100 dark:hover:bg-ink-800"
                          onClick={() => void handleRotateIngest(row.id)}
                        >
                          {patchingId === row.id ? t("inboxesPage.saving") : t("inboxesPage.rotateIngestToken")}
                        </button>
                        <p className="text-[11px] leading-snug text-gray-500 dark:text-ink-500">
                          {t("inboxesPage.outboundWebhookDoc")}
                        </p>
                      </div>
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
