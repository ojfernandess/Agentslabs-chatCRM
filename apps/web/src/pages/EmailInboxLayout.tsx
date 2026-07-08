import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useMatch, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Inbox, Mail, MessageSquare, PenSquare, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { InboxChannelIcon } from "@/components/inboxes/InboxChannelIcon";
import {
  EmailInboxConfigFields,
  emailInboxFormFromChannelConfig,
  emailInboxFormToPatch,
  emptyEmailInboxForm,
  type EmailInboxFormState,
} from "@/components/inboxes/EmailInboxConfigFields";
import { EmailInboundSetupPanel } from "@/components/inboxes/EmailInboundSetupPanel";
import { EmailComposeModal } from "@/components/inboxes/EmailComposeModal";
import {
  buildInboxEmailChannelConfig,
  MASKED_EMAIL_SECRET,
  parseInboxEmailFromChannelConfig,
} from "@/lib/inboxEmailConfig";
import { inboxIsChannelReady } from "@/lib/inboxChannelUi";
import { contactEmailDisplay, emailMessagePreviewText, emailThreadSubject } from "@/lib/contactEmailDisplay";
import {
  ConversationContextMenu,
  type ConversationContextMenuUpdate,
  type ConversationContextTarget,
} from "@/components/ConversationContextMenu";
import { ConversationPriorityBadge } from "@/components/ConversationPriorityBadge";
import {
  isConversationPriority,
  priorityListCardClass,
  type ConversationPriority,
} from "@/lib/conversationPriority";
import {
  getCachedConversation,
  getInflightConversation,
  invalidateCachedConversation,
  setCachedConversation,
  setInflightConversation,
} from "@/lib/conversationDetailCache";

type EmailInboxRow = {
  id: string;
  name: string;
  description: string | null;
  channelType: string;
  ingestToken?: string | null;
  channelConfig?: unknown;
};

type EmailConversation = {
  id: string;
  status: string;
  priority?: ConversationPriority | null;
  isUnread?: boolean;
  deletedAt?: string | null;
  updatedAt: string;
  contact: {
    id: string;
    name: string;
    email?: string | null;
    phone: string;
    profilePictureUrl?: string | null;
    hasAvatar?: boolean;
    thumbnail?: string | null;
  };
  messages: { body: string | null; direction: string; createdAt: string }[];
};

type EmailFolder = "inbox" | "trash";

const statusColors: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700 dark:bg-emerald-950/55 dark:text-emerald-200",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-950/45 dark:text-amber-200",
  RESOLVED: "bg-gray-100 text-gray-600 dark:bg-ink-800 dark:text-ink-300",
};

function contactEmailLabel(contact: EmailConversation["contact"]): string | null {
  return contactEmailDisplay(contact);
}

export function EmailInboxLayout() {
  const { inboxId } = useParams<{ inboxId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, dateLocale } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role);

  const tab = searchParams.get("tab") === "settings" && isAdmin ? "settings" : "messages";
  const folder: EmailFolder = searchParams.get("folder") === "trash" ? "trash" : "inbox";
  const [inbox, setInbox] = useState<EmailInboxRow | null>(null);
  const [conversations, setConversations] = useState<EmailConversation[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [listSearch, setListSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [editForm, setEditForm] = useState<EmailInboxFormState>(emptyEmailInboxForm());
  const [saving, setSaving] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSentTo, setTestSentTo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    target: ConversationContextTarget;
    position: { x: number; y: number };
  } | null>(null);

  const activeThreadMatch = useMatch("/inboxes/:inboxId/email/c/:id");
  const activeThreadId = activeThreadMatch?.params.id;

  const basePublicInbox =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1/public/inbox` : "";

  const ready = useMemo(
    () =>
      inbox
        ? inboxIsChannelReady(inbox.channelType, inbox.channelConfig, inbox.ingestToken)
        : false,
    [inbox],
  );

  const emailFrom = useMemo(
    () => (inbox ? parseInboxEmailFromChannelConfig(inbox.channelConfig).emailFromAddress : undefined),
    [inbox],
  );

  const setTab = useCallback(
    (next: "messages" | "settings") => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (next === "settings") n.set("tab", "settings");
          else n.delete("tab");
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFolder = useCallback(
    (next: EmailFolder) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete("tab");
          if (next === "trash") n.set("folder", "trash");
          else n.delete("folder");
          return n;
        },
        { replace: true },
      );
      if (activeThreadId && inboxId) {
        const qs = next === "trash" ? "?folder=trash" : "";
        navigate(`/inboxes/${inboxId}/email${qs}`, { replace: true });
      }
    },
    [setSearchParams, activeThreadId, navigate, inboxId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(listSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [listSearch]);

  const loadInbox = useCallback(async () => {
    if (!inboxId) return;
    const row = await api.get<EmailInboxRow>(`/inboxes/${inboxId}`);
    if (row.channelType !== "EMAIL") {
      navigate("/inboxes", { replace: true });
      return;
    }
    setInbox(row);
    if (isAdmin) {
      setEditForm(emailInboxFormFromChannelConfig(row.channelConfig));
    }
  }, [inboxId, isAdmin, navigate]);

  const refreshUnreadCount = useCallback(async () => {
    if (!inboxId) return;
    try {
      const res = await api.get<{ data: EmailConversation[] }>(
        `/conversations?inboxId=${encodeURIComponent(inboxId)}&pageSize=80`,
      );
      setUnreadCount(res.data.filter((c) => c.isUnread).length);
    } catch {
      /* ignore */
    }
  }, [inboxId]);

  const loadConversations = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!inboxId) return;
      if (!opts?.silent) setListLoading(true);
      try {
        const params = new URLSearchParams({
          inboxId,
          pageSize: "80",
        });
        if (folder === "trash") params.set("trash", "1");
        if (debouncedSearch) params.set("q", debouncedSearch);
        const res = await api.get<{ data: EmailConversation[] }>(`/conversations?${params}`);
        setConversations(res.data);
        if (folder === "inbox" && !debouncedSearch) {
          setUnreadCount(res.data.filter((c) => c.isUnread).length);
        } else {
          void refreshUnreadCount();
        }
      } catch {
        if (!opts?.silent) setConversations([]);
      } finally {
        if (!opts?.silent) setListLoading(false);
      }
    },
    [inboxId, folder, debouncedSearch, refreshUnreadCount],
  );

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

  const handleContextMenuUpdated = useCallback(
    (update?: ConversationContextMenuUpdate) => {
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
        invalidateCachedConversation(update.id);
        if (update.isUnread !== undefined) {
          void refreshUnreadCount();
        }
        if (folder === "trash") {
          setConversations((prev) => prev.filter((c) => c.id !== update.id));
        }
      }
      void loadConversations({ silent: true });
    },
    [loadConversations, folder, refreshUnreadCount],
  );

  const statusLabel = useCallback(
    (status: string) => {
      if (status === "OPEN") return t("conversationDetail.statusOpen");
      if (status === "PENDING") return t("conversationDetail.statusPending");
      if (status === "RESOLVED") return t("conversationDetail.statusResolved");
      return status;
    },
    [t],
  );

  useEffect(() => {
    if (conversations.length === 0) return;
    for (const conv of conversations.slice(0, 40)) {
      prefetchConversation(conv.id);
    }
  }, [conversations, prefetchConversation]);

  useEffect(() => {
    if (!inboxId) return;
    void (async () => {
      setLoading(true);
      try {
        await loadInbox();
      } finally {
        setLoading(false);
      }
    })();
  }, [inboxId, loadInbox]);

  useEffect(() => {
    if (!inboxId || loading) return;
    void loadConversations();
  }, [inboxId, loading, loadConversations]);

  useEffect(() => {
    const onRead = (e: Event) => {
      const conversationId = (e as CustomEvent<{ conversationId?: string }>).detail?.conversationId;
      if (!conversationId) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, isUnread: false } : c)),
      );
      setUnreadCount((n) => Math.max(0, n - 1));
    };
    window.addEventListener("openconduit:conversation-read", onRead);
    return () => window.removeEventListener("openconduit:conversation-read", onRead);
  }, []);

  const syncInbox = useCallback(async (opts?: { reprocess?: boolean }) => {
    if (!inboxId || !ready) return;
    setSyncBusy(true);
    setSyncNotice(null);
    try {
      const qs = opts?.reprocess ? "?reprocess=1" : "";
      const res = await api.post<{ processed: number; skipped: number; error?: string }>(
        `/inboxes/${inboxId}/sync-email${qs}`,
      );
      if (res.error) {
        setSyncNotice(t("inboxesPage.emailWorkspace.syncFailed"));
      } else if (res.processed > 0) {
        setSyncNotice(t("inboxesPage.emailWorkspace.syncImported").replace("{count}", String(res.processed)));
      }
      if (opts?.reprocess) {
        setConversations((prev) => {
          for (const conv of prev) invalidateCachedConversation(conv.id);
          return prev;
        });
        if (activeThreadId) {
          invalidateCachedConversation(activeThreadId);
          window.dispatchEvent(
            new CustomEvent("openconduit:conversation-updated", {
              detail: { conversationId: activeThreadId },
            }),
          );
        }
      }
      await loadConversations({ silent: true });
    } catch {
      setSyncNotice(t("inboxesPage.emailWorkspace.syncFailed"));
    } finally {
      setSyncBusy(false);
    }
  }, [inboxId, ready, t, loadConversations, activeThreadId]);

  // Sync inicial com upgrade HTML (uma vez por caixa); polling só importa novos.
  useEffect(() => {
    if (tab !== "messages" || !ready || !inboxId) return;
    void syncInbox({ reprocess: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na entrada da caixa / ready
  }, [tab, ready, inboxId]);

  useEffect(() => {
    if (tab !== "messages" || !ready || !inboxId) return;
    const interval = window.setInterval(() => {
      void syncInbox();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [tab, ready, inboxId, syncInbox]);

  const runTest = useCallback(async () => {
    if (!inboxId) return;
    setTestBusy(true);
    setTestResult(null);
    setTestError(null);
    setTestSentTo(null);
    try {
      const channelConfig = buildInboxEmailChannelConfig(inbox?.channelConfig, emailInboxFormToPatch(editForm));
      const res = await api.post<{ connected: boolean; error?: string; sentTo?: string }>(
        `/inboxes/${inboxId}/test-email`,
        { channelConfig },
      );
      setTestResult(res.connected);
      setTestError(res.error ?? null);
      setTestSentTo(res.sentTo ?? null);
    } catch (e) {
      setTestResult(false);
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestBusy(false);
    }
  }, [inboxId, inbox?.channelConfig, editForm]);

  const saveSettings = useCallback(async () => {
    if (!inboxId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const merged = buildInboxEmailChannelConfig(inbox?.channelConfig, emailInboxFormToPatch(editForm));
      await api.patch(`/inboxes/${inboxId}`, { channelConfig: merged });
      await loadInbox();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [inboxId, inbox?.channelConfig, editForm, loadInbox]);

  if (loading && !inbox) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-500">{t("common.loading")}</div>
    );
  }

  if (!inbox || !inboxId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-500">
        {t("conversationDetail.notFound")}
      </div>
    );
  }

  const emptyLabel =
    folder === "trash"
      ? t("inboxesPage.emailWorkspace.emptyTrash")
      : debouncedSearch
        ? t("inboxesPage.emailWorkspace.searchEmpty")
        : t("inboxesPage.emailWorkspace.emptyThreads");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f8fc] dark:bg-[#0B1220]">
      <header className="shrink-0 border-b border-ink-200 bg-white px-4 py-3 dark:border-ink-800 dark:bg-[#0F1B2B] sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/inboxes"
              className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <InboxChannelIcon channelType="EMAIL" size="md" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-ink-900 dark:text-ink-50">{inbox.name}</h1>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                {emailFrom ?? t("inboxesPage.wizard.emailInbox.inboxStatusNotConfigured")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                ready
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/20 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "bg-amber-50 text-amber-800 ring-1 ring-amber-500/25 dark:bg-amber-950/40 dark:text-amber-200",
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-500" : "bg-amber-500")} />
              {ready
                ? t("inboxesPage.wizard.emailInbox.inboxStatusConfigured")
                : t("inboxesPage.wizard.emailInbox.inboxStatusNotConfigured")}
            </span>
            {isAdmin ? (
              <nav className="flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900">
                <button
                  type="button"
                  onClick={() => setTab("messages")}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                    tab === "messages"
                      ? "bg-brand-600 text-white"
                      : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("inboxesPage.emailWorkspace.tabMessages")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("settings")}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                    tab === "settings"
                      ? "bg-brand-600 text-white"
                      : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
                  )}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {t("inboxesPage.emailWorkspace.tabSettings")}
                </button>
              </nav>
            ) : null}
          </div>
        </div>
      </header>

      {tab === "settings" && isAdmin ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
            <div className="card-surface border p-5 dark:border-ink-700">
              <h2 className="mb-1 text-sm font-semibold text-ink-900 dark:text-ink-50">
                {t("inboxesPage.wizard.emailInbox.editSectionTitle")}
              </h2>
              <p className="mb-4 text-xs text-ink-500">{t("inboxesPage.wizard.emailInbox.editSectionHint")}</p>
              <EmailInboxConfigFields
                form={editForm}
                onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                passwordStored={
                  parseInboxEmailFromChannelConfig(inbox.channelConfig).emailSmtpPassword === MASKED_EMAIL_SECRET
                }
                onTestConnection={() => void runTest()}
                testConnectionBusy={testBusy}
                testConnectionResult={testResult}
                testConnectionError={testError}
                testConnectionSentTo={testSentTo}
              />
              {saveError ? (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                  {saveError}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveSettings()}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </div>
            {inbox.ingestToken && basePublicInbox ? (
              <div className="card-surface border p-5 dark:border-ink-700">
                <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">
                  {t("inboxesPage.wizard.emailInbox.inboundSectionTitle")}
                </h2>
                <EmailInboundSetupPanel
                  inboundUrl={`${basePublicInbox}/${inbox.ingestToken}/inbound`}
                  fromAddress={emailFrom}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-ink-200 bg-white dark:border-ink-800 dark:bg-[#0F1B2B] lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2.5 dark:border-ink-800">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
                disabled={!ready || folder === "trash"}
                onClick={() => setComposeOpen(true)}
              >
                <PenSquare className="h-3.5 w-3.5" />
                {t("inboxesPage.emailWorkspace.composeButton")}
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
                title={syncBusy ? t("inboxesPage.emailWorkspace.syncBusy") : t("inboxesPage.emailWorkspace.syncInbox")}
                disabled={!ready || syncBusy}
                onClick={() => void syncInbox({ reprocess: true })}
              >
                <RefreshCw className={clsx("h-4 w-4", syncBusy && "animate-spin")} />
              </button>
            </div>

            <div className="space-y-1 border-b border-ink-100 px-2 py-2 dark:border-ink-800">
              <button
                type="button"
                onClick={() => setFolder("inbox")}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                  folder === "inbox"
                    ? "bg-ink-100 font-medium text-ink-900 dark:bg-ink-800 dark:text-ink-50"
                    : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-900/60",
                )}
              >
                <Inbox className="h-4 w-4 shrink-0 text-ink-500 dark:text-ink-400" />
                <span className="min-w-0 flex-1 truncate">{t("inboxesPage.emailWorkspace.folderInbox")}</span>
                {unreadCount > 0 ? (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-700 px-1.5 text-[11px] font-semibold text-white dark:bg-ink-200 dark:text-ink-900"
                    title={t("inboxesPage.emailWorkspace.unreadCountLabel").replace("{count}", String(unreadCount))}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setFolder("trash")}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                  folder === "trash"
                    ? "bg-ink-100 font-medium text-ink-900 dark:bg-ink-800 dark:text-ink-50"
                    : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-900/60",
                )}
              >
                <Trash2 className="h-4 w-4 shrink-0 text-ink-500 dark:text-ink-400" />
                <span className="min-w-0 flex-1 truncate">{t("inboxesPage.emailWorkspace.folderTrash")}</span>
              </button>
            </div>

            <div className="border-b border-ink-100 px-3 py-2 dark:border-ink-800">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                <input
                  type="search"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder={t("inboxesPage.emailWorkspace.searchPlaceholder")}
                  className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2 pl-8 pr-3 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                />
              </label>
            </div>

            {syncNotice ? (
              <p className="border-b border-ink-100 px-3 py-2 text-[11px] text-ink-600 dark:border-ink-800 dark:text-ink-300">
                {syncNotice}
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {listLoading ? (
                <p className="p-4 text-xs text-ink-500">{t("common.loading")}</p>
              ) : conversations.length === 0 ? (
                <p className="p-4 text-xs text-ink-500">{emptyLabel}</p>
              ) : (
                <ul>
                  {conversations.map((conv) => {
                    const last = conv.messages[0];
                    const preview = emailMessagePreviewText(last?.body) || "—";
                    const subject = emailThreadSubject(last?.body, t("inboxesPage.emailWorkspace.noSubject"));
                    const email = contactEmailLabel(conv.contact);
                    return (
                      <li
                        key={conv.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            target: {
                              id: conv.id,
                              status: conv.status,
                              priority: conv.priority ?? null,
                              isUnread: conv.isUnread,
                              deletedAt: conv.deletedAt ?? (folder === "trash" ? new Date().toISOString() : null),
                              contact: { id: conv.contact.id, name: conv.contact.name },
                            },
                            position: { x: e.clientX, y: e.clientY },
                          });
                        }}
                      >
                        <NavLink
                          to={`/inboxes/${inboxId}/email/c/${conv.id}${folder === "trash" ? "?folder=trash" : ""}`}
                          preventScrollReset
                          onMouseDown={() => prefetchConversation(conv.id)}
                          onMouseEnter={() => prefetchConversation(conv.id)}
                          onFocus={() => prefetchConversation(conv.id)}
                          className={({ isActive }) =>
                            clsx(
                              "block border-b border-ink-100 px-4 py-3 transition dark:border-ink-800",
                              priorityListCardClass(conv.priority),
                              conv.isUnread && "bg-brand-50/50 dark:bg-brand-950/20",
                              isActive || activeThreadId === conv.id
                                ? "border-l-[3px] border-l-brand-500 bg-brand-50 dark:bg-brand-950/30"
                                : "border-l-[3px] border-l-transparent hover:bg-ink-50 dark:hover:bg-ink-900/40",
                            )
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              {conv.isUnread ? (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full bg-brand-500 ring-2 ring-brand-200 dark:ring-brand-900/50"
                                  title={t("conversations.unreadBadge")}
                                  aria-hidden
                                />
                              ) : null}
                              <p
                                className={clsx(
                                  "truncate text-sm text-ink-900 dark:text-ink-50",
                                  conv.isUnread ? "font-bold" : "font-medium",
                                )}
                              >
                                {conv.contact.name}
                              </p>
                              {isConversationPriority(conv.priority) ? (
                                <ConversationPriorityBadge priority={conv.priority} variant="compact" />
                              ) : null}
                              <span
                                className={clsx(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                  statusColors[conv.status] ?? statusColors.OPEN,
                                )}
                              >
                                {statusLabel(conv.status)}
                              </span>
                            </div>
                            <span className="shrink-0 text-[10px] text-ink-400">
                              {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: false, locale: dateLocale })}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-ink-700 dark:text-ink-200">{subject}</p>
                          {email ? (
                            <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">{email}</p>
                          ) : null}
                          <p className="mt-1 truncate text-xs text-ink-500 dark:text-ink-400">{preview}</p>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
          <main className="min-h-0 flex min-w-0 flex-col bg-white dark:bg-[#0E1624]">
            <Outlet context={{ inboxId, refreshThreads: loadConversations }} />
          </main>
        </div>
      )}
      <EmailComposeModal
        open={composeOpen}
        inboxId={inboxId}
        fromAddress={emailFrom}
        smtpReady={ready}
        onClose={() => setComposeOpen(false)}
        onSent={(conversationId) => {
          void loadConversations();
          navigate(`/inboxes/${inboxId}/email/c/${conversationId}`);
        }}
      />
      <ConversationContextMenu
        target={contextMenu?.target ?? null}
        position={contextMenu?.position ?? null}
        onClose={() => setContextMenu(null)}
        conversationPath={(conversationId) =>
          `/inboxes/${inboxId}/email/c/${conversationId}${folder === "trash" ? "?folder=trash" : ""}`
        }
        onUpdated={handleContextMenuUpdated}
        onDeleted={(conversationId) => {
          setConversations((prev) => prev.filter((c) => c.id !== conversationId));
          setContextMenu(null);
          void refreshUnreadCount();
          if (activeThreadId === conversationId) {
            navigate(`/inboxes/${inboxId}/email${folder === "trash" ? "?folder=trash" : ""}`, {
              replace: true,
            });
          }
        }}
      />
    </div>
  );
}

export type EmailInboxOutletContext = {
  inboxId: string;
  refreshThreads: () => Promise<void>;
};

export function EmailInboxThreadPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#f6f8fc] p-8 text-center dark:bg-[#0E1624]">
      <Mail className="mb-3 h-12 w-12 text-brand-500/70" />
      <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
        {t("inboxesPage.emailWorkspace.selectThread")}
      </p>
      <p className="mt-1 max-w-sm text-xs text-ink-500">{t("inboxesPage.emailWorkspace.selectThreadHint")}</p>
    </div>
  );
}
