import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Mail, MessageSquare, Settings2 } from "lucide-react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition } from "@/components/Motion";
import { InboxChannelIcon } from "@/components/inboxes/InboxChannelIcon";
import {
  EmailInboxConfigFields,
  emailInboxFormFromChannelConfig,
  emailInboxFormToPatch,
  emptyEmailInboxForm,
  type EmailInboxFormState,
} from "@/components/inboxes/EmailInboxConfigFields";
import { EmailInboundSetupPanel } from "@/components/inboxes/EmailInboundSetupPanel";
import {
  buildInboxEmailChannelConfig,
  MASKED_EMAIL_SECRET,
  parseInboxEmailFromChannelConfig,
} from "@/lib/inboxEmailConfig";
import { inboxIsChannelReady } from "@/lib/inboxChannelUi";
import { formatMessageBodyForPreview } from "@/lib/messagePreviewText";
import { ConversationListAvatar } from "@/components/ConversationListAvatar";

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

function contactEmailLabel(contact: EmailConversation["contact"]): string | null {
  const direct = contact.email?.trim();
  if (direct && direct.includes("@")) return direct;
  const prefix = "oc|EMAIL|";
  if (contact.phone.startsWith(prefix)) {
    const participant = contact.phone.slice(prefix.length).trim();
    if (participant.includes("@")) return participant;
  }
  return null;
}

export function EmailInboxLayout() {
  const { inboxId } = useParams<{ inboxId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, dateLocale } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role);

  const tab = searchParams.get("tab") === "settings" && isAdmin ? "settings" : "messages";
  const [inbox, setInbox] = useState<EmailInboxRow | null>(null);
  const [conversations, setConversations] = useState<EmailConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [editForm, setEditForm] = useState<EmailInboxFormState>(emptyEmailInboxForm());
  const [saving, setSaving] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const loadConversations = useCallback(async () => {
    if (!inboxId) return;
    setListLoading(true);
    try {
      const res = await api.get<{ data: EmailConversation[] }>(
        `/conversations?inboxId=${encodeURIComponent(inboxId)}&limit=80`,
      );
      setConversations(res.data);
    } catch {
      setConversations([]);
    } finally {
      setListLoading(false);
    }
  }, [inboxId]);

  useEffect(() => {
    if (!inboxId) return;
    void (async () => {
      setLoading(true);
      try {
        await loadInbox();
        await loadConversations();
      } finally {
        setLoading(false);
      }
    })();
  }, [inboxId, loadInbox, loadConversations]);

  const setTab = (next: "messages" | "settings") => {
    if (next === "settings") setSearchParams({ tab: "settings" });
    else setSearchParams({});
  };

  const saveSettings = async () => {
    if (!inboxId || !isAdmin) return;
    setSaving(true);
    setSaveError(null);
    try {
      const merged = buildInboxEmailChannelConfig(inbox?.channelConfig, emailInboxFormToPatch(editForm));
      await api.patch(`/inboxes/${inboxId}`, { channelConfig: merged });
      await loadInbox();
    } catch {
      setSaveError(t("inboxesPage.editSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!inboxId) return;
    setTestBusy(true);
    setTestResult(null);
    setTestError(null);
    try {
      const channelConfig = buildInboxEmailChannelConfig(inbox?.channelConfig, emailInboxFormToPatch(editForm));
      const res = await api.post<{ connected: boolean; error?: string | null }>(
        `/inboxes/${inboxId}/test-email-connection`,
        { channelConfig },
      );
      setTestResult(res.connected);
      setTestError(res.error ?? null);
    } catch {
      setTestResult(false);
    } finally {
      setTestBusy(false);
    }
  };

  if (!inboxId) return null;

  if (loading || !inbox) {
    return (
      <PageTransition>
        <div className="flex h-full items-center justify-center p-8 text-sm text-ink-500">
          {t("common.loading")}
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-amber-50/40 to-ink-50 dark:from-amber-950/10 dark:to-[#0E1624]">
        <header className="shrink-0 border-b border-amber-200/60 bg-white/90 px-4 py-4 backdrop-blur-md dark:border-amber-900/30 dark:bg-[#0F1B2B]/80 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Link
                to="/inboxes"
                className="mt-1 rounded-xl p-2 text-ink-500 transition hover:bg-amber-100/80 hover:text-ink-800 dark:hover:bg-amber-950/40"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <InboxChannelIcon channelType="EMAIL" size="lg" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  {t("inboxesPage.emailWorkspace.kicker")}
                </p>
                <h1 className="truncate text-xl font-semibold text-ink-900 dark:text-ink-50">{inbox.name}</h1>
                <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-400">
                  {emailFrom ?? t("inboxesPage.wizard.emailInbox.inboxStatusNotConfigured")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
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
              <nav className="flex rounded-xl border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900">
                <button
                  type="button"
                  onClick={() => setTab("messages")}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    tab === "messages"
                      ? "bg-amber-500 text-white shadow-sm"
                      : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("inboxesPage.emailWorkspace.tabMessages")}
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setTab("settings")}
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                      tab === "settings"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
                    )}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    {t("inboxesPage.emailWorkspace.tabSettings")}
                  </button>
                ) : null}
              </nav>
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
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-ink-200 bg-white/70 dark:border-ink-800 dark:bg-[#0F1B2B]/50 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
                <div className="flex items-center gap-2 text-sm font-medium text-ink-800 dark:text-ink-100">
                  <Mail className="h-4 w-4 text-amber-600" />
                  {t("inboxesPage.emailWorkspace.threadListTitle")}
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  onClick={() => void loadConversations()}
                >
                  {t("common.refresh")}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {listLoading ? (
                  <p className="p-4 text-xs text-ink-500">{t("common.loading")}</p>
                ) : conversations.length === 0 ? (
                  <p className="p-4 text-xs text-ink-500">{t("inboxesPage.emailWorkspace.emptyThreads")}</p>
                ) : (
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {conversations.map((conv) => {
                      const last = conv.messages[0];
                      const preview = last?.body ? formatMessageBodyForPreview(last.body) : "—";
                      const email = contactEmailLabel(conv.contact);
                      return (
                        <li key={conv.id}>
                          <Link
                            to={`/inboxes/${inboxId}/email/c/${conv.id}`}
                            className="flex gap-3 px-4 py-3 transition hover:bg-amber-50/70 dark:hover:bg-amber-950/20"
                          >
                            <ConversationListAvatar
                              contactId={conv.contact.id}
                              contactName={conv.contact.name}
                              profilePictureUrl={conv.contact.profilePictureUrl}
                              hasAvatar={conv.contact.hasAvatar}
                              thumbnail={conv.contact.thumbnail}
                              channelType="EMAIL"
                              size="list"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">
                                  {conv.contact.name}
                                </p>
                                <span className="shrink-0 text-[10px] text-ink-400">
                                  {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: true, locale: dateLocale })}
                                </span>
                              </div>
                              {email ? (
                                <p className="truncate text-[11px] text-amber-800/90 dark:text-amber-200/80">{email}</p>
                              ) : null}
                              <p className="mt-0.5 truncate text-xs text-ink-500">{preview}</p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>
            <main className="min-h-0 flex flex-col bg-white/40 dark:bg-[#0E1624]/40">
              <Outlet context={{ inboxId, refreshThreads: loadConversations }} />
            </main>
          </div>
        )}
      </div>
    </PageTransition>
  );
}

export type EmailInboxOutletContext = {
  inboxId: string;
  refreshThreads: () => Promise<void>;
};

export function EmailInboxThreadPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <Mail className="mb-3 h-10 w-10 text-amber-500/80" />
      <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
        {t("inboxesPage.emailWorkspace.selectThread")}
      </p>
      <p className="mt-1 max-w-sm text-xs text-ink-500">{t("inboxesPage.emailWorkspace.selectThreadHint")}</p>
    </div>
  );
}
