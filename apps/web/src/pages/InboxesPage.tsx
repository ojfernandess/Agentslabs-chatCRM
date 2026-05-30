import { useState, useEffect, useMemo } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition } from "@/components/Motion";
import { HelpCircle, Plus, Trash2 } from "lucide-react";
import { InboxCreateWizard, INBOX_CHANNEL_ORDER } from "@/components/InboxCreateWizard";
import { InboxesKpiStrip, type InboxKpiStats } from "@/components/inboxes/InboxesKpiStrip";
import {
  InboxesToolbar,
  type InboxChannelFilter,
  type InboxStatusFilter,
  type InboxViewMode,
} from "@/components/inboxes/InboxesToolbar";
import { InboxCard } from "@/components/inboxes/InboxCard";
import { InboxesTipBanner } from "@/components/inboxes/InboxesTipBanner";
import { inboxIsChannelReady } from "@/lib/inboxChannelUi";
import { WebsiteWidgetBuilder } from "@/components/WebsiteWidgetBuilder";
import {
  websiteWidgetFromChannelConfig,
  websiteWidgetToChannelConfig,
  type WebsiteWidgetForm,
} from "@/lib/websiteWidget";
import { WhatsAppProviderConfigFields } from "@/components/inboxes/WhatsAppProviderConfigFields";
import {
  buildInboxWhatsappChannelConfig,
  isWhatsAppCloudApiProvider,
  parseInboxWhatsappFromChannelConfig,
} from "@/lib/inboxWhatsappConfig";
import { MASKED_WHATSAPP_SECRET } from "@/lib/whatsappOrgConfig";
import { WhatsAppMetaWebhookCopyPanel } from "@/components/inboxes/WhatsAppMetaWebhookCopyPanel";

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

type InboxBotSummary = { id: string; name: string; type: string; isActive: boolean };

type InboxRow = {
  id: string;
  name: string;
  description: string | null;
  channelType: string;
  isDefault: boolean;
  ingestToken?: string | null;
  channelConfig?: unknown | null;
  whatsappWebhookUrl?: string;
  whatsappWebhookVerifyToken?: string | null;
  whatsappConfigured?: boolean;
  agentBotId?: string | null;
  agentBot?: InboxBotSummary | null;
  members?: InboxMemberRow[];
  createdAt?: string;
  _count: { members: number; conversations: number };
};

type ChannelSettings = {
  evolutionPlatformQrMode?: boolean;
  evolutionGoPlatformMode?: boolean;
};

function nativeUrlsForChannel(channelType: string, token: string, baseNative: string): { key: string; labelKey: string; url: string }[] {
  const b = `${baseNative}/${encodeURIComponent(token)}`;
  switch (channelType) {
    case "WEBSITE":
    case "API":
      return [
        {
          key: "client",
          labelKey: "inboxesPage.wizard.ingestClientApiUrl",
          url: `${b}/contacts/{visitor_uuid}/messages`,
        },
      ];
    case "FACEBOOK":
      return [{ key: "fb", labelKey: "inboxesPage.wizard.ingestFacebookUrl", url: `${b}/facebook` }];
    case "INSTAGRAM":
      return [{ key: "ig", labelKey: "inboxesPage.wizard.ingestInstagramUrl", url: `${b}/instagram` }];
    case "TELEGRAM":
      return [{ key: "tg", labelKey: "inboxesPage.wizard.ingestTelegramUrl", url: `${b}/telegram` }];
    case "LINE":
      return [{ key: "line", labelKey: "inboxesPage.wizard.ingestLineUrl", url: `${b}/line` }];
    case "SMS":
    case "VOICE":
      return [{ key: "twilio", labelKey: "inboxesPage.wizard.ingestTwilioUrl", url: `${b}/twilio` }];
    default:
      return [];
  }
}

export function InboxesPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [agentBots, setAgentBots] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
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
  const [editAgentBotId, setEditAgentBotId] = useState("");
  const [copiedInboxId, setCopiedInboxId] = useState<string | null>(null);
  const [channelSettings, setChannelSettings] = useState<ChannelSettings | null>(null);
  const [editProvider, setEditProvider] = useState("meta");
  const [editDisplayPhone, setEditDisplayPhone] = useState("");
  const [editWabaId, setEditWabaId] = useState("");
  const [editProviderApiKey, setEditProviderApiKey] = useState("");
  const [editWebhookSecret, setEditWebhookSecret] = useState("");
  const [editProviderPhoneId, setEditProviderPhoneId] = useState("");
  const [editProviderEvoBaseUrl, setEditProviderEvoBaseUrl] = useState("");
  const [editWebsiteWidget, setEditWebsiteWidget] = useState<WebsiteWidgetForm | null>(null);
  const [waTestBusy, setWaTestBusy] = useState(false);
  const [waTestResult, setWaTestResult] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<InboxChannelFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>("ALL");
  const [viewMode, setViewMode] = useState<InboxViewMode>("list");

  const basePublicInbox =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1/public/inbox` : "";
  const basePublicNative =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1/public/channels/inboxes` : "";

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const copyInboxId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedInboxId(id);
      window.setTimeout(() => setCopiedInboxId(null), 2000);
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

  const refreshChannelSettings = async (): Promise<ChannelSettings | null> => {
    if (!isAdmin) return null;
    try {
      const cfg = await api.get<ChannelSettings>("/settings");
      setChannelSettings(cfg);
      return cfg;
    } catch {
      return null;
    }
  };

  const load = async () => {
    try {
      const res = await api.get<{ data: InboxRow[] }>("/inboxes");
      setRows(res.data);
      await refreshChannelSettings();
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
        const botsRes = await api.get<{ data: { id: string; name: string; isActive: boolean }[] }>("/bots");
        setAgentBots(botsRes.data.map((b) => ({ id: b.id, name: b.name, isActive: b.isActive })));
        await load();
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const onFocus = () => {
      void refreshChannelSettings();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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

  const startEdit = async (row: InboxRow) => {
    setExpanded((p) => ({ ...p, [row.id]: true }));
    setEditingId(row.id);
    setEditName(row.name);
    setEditDescription(row.description ?? "");
    setEditChannel(row.channelType);
    setEditWebhook(outboundWebhookFromConfig(row.channelConfig));
    setEditAgentBotId(row.agentBotId ?? "");
    await refreshChannelSettings();
    const wa = parseInboxWhatsappFromChannelConfig(row.channelConfig);
    setEditProvider(wa.whatsappProvider ?? "meta");
    setEditProviderPhoneId(wa.whatsappPhoneNumberId ?? "");
    setEditProviderEvoBaseUrl(wa.evolutionApiBaseUrl ?? "");
    setEditProviderApiKey("");
    setEditWebhookSecret("");
    setEditDisplayPhone(wa.whatsappDisplayPhone ?? "");
    setEditWabaId(wa.whatsappBusinessAccountId ?? "");
    setWaTestBusy(false);
    setWaTestResult(null);
    setEditWebsiteWidget(
      row.channelType === "WEBSITE"
        ? websiteWidgetFromChannelConfig(row.channelConfig, row.name)
        : null,
    );
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditWebsiteWidget(null);
    setWaTestResult(null);
  };

  const runWhatsappTestForEdit = async (inboxId: string) => {
    setWaTestBusy(true);
    setWaTestResult(null);
    try {
      const channelConfig = buildInboxWhatsappChannelConfig(
        rows.find((r) => r.id === inboxId)?.channelConfig,
        {
          whatsappProvider: editProvider,
          whatsappPhoneNumberId: editProviderPhoneId,
          whatsappApiKey: editProviderApiKey,
          whatsappWebhookSecret: editWebhookSecret,
          evolutionApiBaseUrl: editProviderEvoBaseUrl,
          whatsappDisplayPhone: editDisplayPhone,
          whatsappBusinessAccountId: editWabaId,
        },
      );
      const res = await api.post<{ connected: boolean }>(`/inboxes/${inboxId}/test-whatsapp-connection`, {
        channelConfig,
      });
      setWaTestResult(res.connected);
    } catch {
      setWaTestResult(false);
    } finally {
      setWaTestBusy(false);
    }
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
      if (editChannel === "WEBSITE" && editWebsiteWidget) {
        const widgetCfg = websiteWidgetToChannelConfig({
          ...editWebsiteWidget,
          siteName: editWebsiteWidget.siteName.trim() || n,
        });
        Object.assign(prev, widgetCfg);
      }
      if (editChannel === "WHATSAPP") {
        const merged = buildInboxWhatsappChannelConfig(prev, {
          whatsappProvider: editProvider,
          whatsappPhoneNumberId: editProviderPhoneId,
          whatsappApiKey: editProviderApiKey,
          whatsappWebhookSecret: editWebhookSecret,
          evolutionApiBaseUrl: editProviderEvoBaseUrl,
          whatsappDisplayPhone: editDisplayPhone,
          whatsappBusinessAccountId: editWabaId,
        });
        Object.assign(prev, merged);
      }
      const channelConfigPayload = Object.keys(prev).length > 0 ? prev : null;

      await api.patch(`/inboxes/${inboxId}`, {
        name: n,
        description: editDescription.trim() || null,
        channelType: editChannel,
        channelConfig: channelConfigPayload,
        agentBotId: editAgentBotId.trim() ? editAgentBotId.trim() : null,
      });
      setEditingId(null);
      setEditWebsiteWidget(null);
      await load();
    } catch {
      window.alert(t("inboxesPage.editSaveFailed"));
    } finally {
      setEditSavingId(null);
    }
  };

  const kpiStats = useMemo((): InboxKpiStats => {
    let whatsappReady = 0;
    let connectedChannels = 0;
    let totalConversations = 0;
    let totalMemberSlots = 0;
    for (const row of rows) {
      totalConversations += row._count.conversations;
      totalMemberSlots += row._count.members;
      if (inboxIsChannelReady(row.channelType, row.channelConfig, row.ingestToken, row.whatsappConfigured)) {
        connectedChannels += 1;
      }
      if (row.channelType === "WHATSAPP" && row.whatsappConfigured) {
        whatsappReady += 1;
      }
    }
    return {
      inboxCount: rows.length,
      totalConversations,
      totalMemberSlots,
      connectedChannels,
      whatsappReady,
    };
  }, [rows]);

  const maxConversations = useMemo(
    () => Math.max(1, ...rows.map((r) => r._count.conversations)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q) {
        const hay = `${row.name} ${row.description ?? ""} ${row.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (channelFilter !== "ALL" && row.channelType !== channelFilter) return false;
      const ready = inboxIsChannelReady(
        row.channelType,
        row.channelConfig,
        row.ingestToken,
        row.whatsappConfigured,
      );
      if (statusFilter === "READY" && !ready) return false;
      if (statusFilter === "SETUP" && ready) return false;
      return true;
    });
  }, [rows, search, channelFilter, statusFilter]);

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

  const renderExpandedPanel = (row: InboxRow) => {
    const members = row.members ?? [];
    return (
      <div>
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
                          {editChannel === "WHATSAPP" ? (
                            <div className="mb-3 max-w-md rounded-lg border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-900/40 dark:bg-brand-950/20">
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                                {t("inboxesPage.wizard.whatsappMeta.editSectionTitle")}
                              </p>
                              <p className="mb-3 text-[11px] text-gray-600 dark:text-ink-400">
                                {t("inboxesPage.wizard.whatsappMeta.editSectionHint")}
                              </p>
                              <WhatsAppProviderConfigFields
                                waProvider={editProvider}
                                onProviderChange={setEditProvider}
                                waDisplayPhone={editDisplayPhone}
                                onDisplayPhoneChange={setEditDisplayPhone}
                                waProviderPhoneId={editProviderPhoneId}
                                onPhoneNumberIdChange={setEditProviderPhoneId}
                                waWabaId={editWabaId}
                                onWabaIdChange={setEditWabaId}
                                waProviderApiKey={editProviderApiKey}
                                onApiKeyChange={setEditProviderApiKey}
                                waWebhookSecret={editWebhookSecret}
                                onWebhookSecretChange={setEditWebhookSecret}
                                webhookSecretStored={
                                  parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappWebhookSecret ===
                                  MASKED_WHATSAPP_SECRET
                                }
                                waProviderBaseUrl={editProviderEvoBaseUrl}
                                onBaseUrlChange={setEditProviderEvoBaseUrl}
                                evolutionPlatformQrMode={channelSettings?.evolutionPlatformQrMode ?? false}
                                evolutionGoPlatformMode={channelSettings?.evolutionGoPlatformMode ?? false}
                                apiKeyOptionalHint={
                                  parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappApiKey ===
                                  MASKED_WHATSAPP_SECRET
                                }
                                onTestConnection={() => runWhatsappTestForEdit(row.id)}
                                testConnectionBusy={waTestBusy}
                                testConnectionResult={waTestResult}
                              />
                            </div>
                          ) : null}
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-ink-400">
                            {t("inboxesPage.agentBotField")}
                          </label>
                          <select
                            value={editAgentBotId}
                            onChange={(e) => setEditAgentBotId(e.target.value)}
                            className="mb-1 w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                          >
                            <option value="">{t("inboxesPage.agentBotOrgDefault")}</option>
                            {agentBots.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                                {!b.isActive ? ` ${t("inboxesPage.wizard.agentBotInactive")}` : ""}
                              </option>
                            ))}
                          </select>
                          <p className="mb-3 text-[11px] text-gray-500 dark:text-ink-500">{t("inboxesPage.agentBotHint")}</p>
                          {editChannel === "WEBSITE" && editWebsiteWidget && row.ingestToken ? (
                            <div className="mb-4 rounded-lg border border-ink-200 bg-white p-4 dark:border-ink-600 dark:bg-ink-900/50">
                              <h4 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-100">
                                {t("inboxesPage.wizard.widget.builderTitle")}
                              </h4>
                              <WebsiteWidgetBuilder
                                form={editWebsiteWidget}
                                onChange={(patch) =>
                                  setEditWebsiteWidget((w) => (w ? { ...w, ...patch } : w))
                                }
                                ingestToken={row.ingestToken}
                              />
                            </div>
                          ) : null}
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
                        {row.channelType === "WHATSAPP" &&
                        editingId !== row.id &&
                        isWhatsAppCloudApiProvider(
                          parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappProvider ?? "",
                        ) ? (
                          row.whatsappWebhookUrl && row.whatsappWebhookVerifyToken ? (
                            <div className="mb-3">
                              <WhatsAppMetaWebhookCopyPanel
                                webhookUrl={row.whatsappWebhookUrl}
                                verifyToken={row.whatsappWebhookVerifyToken}
                              />
                            </div>
                          ) : (
                            <p className="mb-2 text-xs text-amber-800/90 dark:text-amber-200/85">
                              {t("inboxesPage.wizard.whatsappMeta.inboxStatusNotConfigured")}
                            </p>
                          )
                        ) : null}
                        {row.ingestToken && row.channelType !== "WHATSAPP" && basePublicNative ? (
                          <>
                            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-ink-400">
                              {t("inboxesPage.ingestNativeSection")}
                            </h4>
                            {row.channelType === "EMAIL" ? (
                              <p className="mb-2 text-xs text-gray-600 dark:text-ink-400">
                                {t("inboxesPage.wizard.ingestEmailHint")}
                              </p>
                            ) : (
                              <ul className="mb-3 space-y-2 text-xs">
                                {nativeUrlsForChannel(row.channelType, row.ingestToken, basePublicNative).map((item) => (
                                  <li
                                    key={item.key}
                                    className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <span className="font-medium text-gray-700 dark:text-ink-200">{t(item.labelKey)}</span>
                                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
                                      <code className="max-w-[min(100%,28rem)] truncate rounded bg-white px-2 py-0.5 dark:bg-ink-950">
                                        {item.url}
                                      </code>
                                      <button
                                        type="button"
                                        className="shrink-0 text-brand-600 hover:underline dark:text-brand-400"
                                        onClick={() => void copyUrl(item.url)}
                                      >
                                        {t("inboxesPage.wizard.ingestCopy")}
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        ) : null}
                        {row.ingestToken && basePublicInbox ? (
                          <>
                            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-ink-400">
                              {t("inboxesPage.ingestLegacySection")}
                            </h4>
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
                          </>
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
    );
  };

  return (
    <PageTransition>
      <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50 sm:text-3xl">
              {t("inboxesPage.title")}
              <span className="sr-only">{t("inboxesPage.subtitle")}</span>
              <HelpCircle className="h-5 w-5 text-ink-400" aria-hidden />
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{t("inboxesPage.subtitle")}</p>
            {!isAdmin ? (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300/90">{t("inboxesPage.readOnlyHint")}</p>
            ) : null}
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 dark:shadow-brand-900/30"
            >
              <Plus className="h-4 w-4" />
              {t("inboxesPage.create")}
            </button>
          ) : null}
        </header>

        <InboxCreateWizard
          open={wizardOpen}
          onClose={() => {
            setWizardOpen(false);
            void refreshChannelSettings();
          }}
          onCreated={() => void load()}
          orgUsers={orgUsers}
          agentBots={agentBots}
        />

        {!loading && rows.length > 0 ? <InboxesKpiStrip stats={kpiStats} /> : null}

        {!loading && rows.length > 0 ? (
          <InboxesToolbar
            search={search}
            onSearchChange={setSearch}
            channelFilter={channelFilter}
            onChannelFilterChange={setChannelFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            channelLabel={channelShort}
          />
        ) : null}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 py-16 text-center dark:border-ink-700 dark:bg-ink-950/30">
            <p className="text-sm text-ink-500 dark:text-ink-400">{t("inboxesPage.empty")}</p>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                {t("inboxesPage.create")}
              </button>
            ) : null}
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-2xl border border-ink-200 bg-white py-12 text-center text-sm text-ink-500 dark:border-ink-700 dark:bg-ink-950/50">
            {t("inboxesPage.dashboard.emptyFilter")}
          </p>
        ) : (
          <div className={viewMode === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "space-y-4"}>
            {filteredRows.map((row) => {
              const open = !!expanded[row.id];
              return (
                <InboxCard
                  key={row.id}
                  row={row}
                  open={open}
                  viewMode={viewMode}
                  maxConversations={maxConversations}
                  locale={locale}
                  isAdmin={isAdmin}
                  canDelete={rows.length > 1}
                  patching={patchingId === row.id}
                  copiedId={copiedInboxId}
                  channelLabel={channelShort}
                  onToggle={() => toggle(row.id)}
                  onEdit={() => void startEdit(row)}
                  onDelete={() => void handleDeleteInbox(row)}
                  onSetDefault={() => void handleSetDefault(row.id)}
                  onCopyId={() => void copyInboxId(row.id)}
                  expandedContent={open && isAdmin ? renderExpandedPanel(row) : undefined}
                />
              );
            })}
          </div>
        )}

        {!loading && rows.length > 0 ? <InboxesTipBanner /> : null}
      </div>
    </PageTransition>
  );
}
