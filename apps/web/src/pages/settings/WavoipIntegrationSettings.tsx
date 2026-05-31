import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Phone,
  Plus,
  Trash2,
  QrCode,
  Copy,
  Check,
  ExternalLink,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { WavoipEvolutionBridgePanel } from "@/components/wavoip/WavoipEvolutionBridgePanel";
import { WavoipMetricsPanel } from "@/components/wavoip/WavoipMetricsPanel";
import { WavoipOutboundIntegrationsPanel } from "@/components/wavoip/WavoipOutboundIntegrationsPanel";
import { WavoipIncomingQueuePanel } from "@/components/wavoip/WavoipIncomingQueuePanel";

type WavoipDeviceRow = {
  id: string;
  name: string;
  connectionMode: string;
  status: string;
  linkedPhone: string | null;
  webhookEnabled: boolean;
  webhookEvents: string[];
  webhookUrl: string;
  sipEnabled: boolean;
  externalConfig: {
    evolutionUrl?: string | null;
    evolutionApiKey?: string | null;
    evolutionInstance?: string | null;
  };
  bridgeStatus: {
    syncedAt: string | null;
    provisionedAt: string | null;
    sourceInboxId: string | null;
    evolutionTokenSetAt: string | null;
    lastValidation: {
      ok: boolean;
      connectionState: string | null;
      message: string | null;
      at: string | null;
    } | null;
  };
  outboundIntegrations: {
    n8n?: { url: string | null; secret?: string | null; events: string[] } | null;
    chatwoot?: { url: string | null; secret?: string | null; events: string[] } | null;
  };
  incomingQueue: {
    mode: "all" | "assignee" | "team";
    teamId: string | null;
    teamName: string | null;
  };
  assignedUserId: string | null;
  assignedUserName: string | null;
  inboxId: string | null;
  inboxName: string | null;
  lastStatusAt: string | null;
  lastError: string | null;
  hasDeviceToken: boolean;
  qrImageUrl: string | null;
};

type InboxOption = { id: string; name: string; isDefault: boolean };
type UserOption = { id: string; name: string };
type TeamOption = { id: string; name: string };

type SipInfo = {
  deviceId: string;
  deviceName: string;
  linkedPhone: string | null;
  sipEnabled: boolean;
  methods: {
    id: string;
    label: string;
    username: string;
    password: string;
    callerId: string;
    note: string;
  }[];
  docsUrl: string;
};

const CONNECTION_MODES = ["QR_NATIVE", "EXTERNAL_EVOLUTION", "EXTERNAL_BAILEYS", "SIP"] as const;

const BRIDGE_HINTS: Record<string, string[]> = {
  EXTERNAL_EVOLUTION: [
    "No painel Wavoip, configure WhatsApp Externo → Evolution com URL, API Key e Instance.",
    "Use a mesma instância Evolution do inbox WhatsApp vinculado.",
    "Não conecte dois devices Wavoip na mesma instância Evolution.",
  ],
  EXTERNAL_BAILEYS: [
    "Configure WhatsApp Externo → Baileys no painel Wavoip.",
    "Mantenha a sessão na sua infraestrutura; a Wavoip usa a ponte para chamadas.",
  ],
  SIP: [
    "Configure um tronco SIP no PABX com as credenciais abaixo.",
    "O CallerID deve coincidir com o número WhatsApp conectado no dispositivo.",
  ],
};

function statusBadgeClass(status: string): string {
  if (status === "OPEN") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
  if (status === "CONNECTING") return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
  if (status === "BUILDING" || status === "RESTARTING")
    return "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200";
  return "bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-ink-300";
}

export function WavoipIntegrationSettings() {
  const { t } = useI18n();
  const [devices, setDevices] = useState<WavoipDeviceRow[]>([]);
  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [deviceToken, setDeviceToken] = useState("");
  const [connectionMode, setConnectionMode] = useState<(typeof CONNECTION_MODES)[number]>("QR_NATIVE");
  const [inboxId, setInboxId] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSipEnabled, setEditSipEnabled] = useState(false);
  const [editEvolutionUrl, setEditEvolutionUrl] = useState("");
  const [editEvolutionApiKey, setEditEvolutionApiKey] = useState("");
  const [editEvolutionInstance, setEditEvolutionInstance] = useState("");
  const [sipPanelId, setSipPanelId] = useState<string | null>(null);
  const [sipInfo, setSipInfo] = useState<SipInfo | null>(null);
  const [sipLoading, setSipLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [devs, inboxList, userList, teamList] = await Promise.all([
        api.get<WavoipDeviceRow[]>("/settings/wavoip/devices"),
        api.get<InboxOption[]>("/settings/wavoip/inboxes"),
        api.get<{ id: string; name: string }[]>("/users"),
        api.get<{ data: { id: string; name: string }[] }>("/teams"),
      ]);
      setDevices(devs);
      setInboxes(inboxList);
      setUsers(userList.map((u) => ({ id: u.id, name: u.name })));
      setTeams(teamList.data.map((t) => ({ id: t.id, name: t.name })));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onDeviceUpdated = () => void load();
    window.addEventListener("openconduit:wavoip-device-updated", onDeviceUpdated);
    return () => window.removeEventListener("openconduit:wavoip-device-updated", onDeviceUpdated);
  }, [load]);

  const createDevice = async () => {
    if (!name.trim() || !deviceToken.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<WavoipDeviceRow & { webhookSecret?: string }>("/settings/wavoip/devices", {
        name: name.trim(),
        deviceToken: deviceToken.trim(),
        connectionMode,
        inboxId: inboxId || null,
      });
      if (res.webhookSecret) setCreatedSecret(res.webhookSecret);
      setShowForm(false);
      setName("");
      setDeviceToken("");
      setInboxId("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const deleteDevice = async (id: string) => {
    if (!window.confirm(t("wavoip.deleteConfirm"))) return;
    try {
      await api.delete(`/settings/wavoip/devices/${id}`);
      if (editingId === id) setEditingId(null);
      if (sipPanelId === id) {
        setSipPanelId(null);
        setSipInfo(null);
      }
      await load();
    } catch {
      setError(t("wavoip.deleteError"));
    }
  };

  const copyWebhook = async (device: WavoipDeviceRow) => {
    try {
      await navigator.clipboard.writeText(device.webhookUrl);
      setCopiedId(device.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const startEdit = (device: WavoipDeviceRow) => {
    setEditingId(device.id);
    setEditSipEnabled(device.sipEnabled);
    setEditEvolutionUrl(device.externalConfig?.evolutionUrl ?? "");
    setEditEvolutionApiKey("");
    setEditEvolutionInstance(device.externalConfig?.evolutionInstance ?? "");
  };

  const saveEdit = async (deviceId: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/settings/wavoip/devices/${deviceId}`, {
        sipEnabled: editSipEnabled,
        externalConfig: {
          evolutionUrl: editEvolutionUrl.trim() || null,
          evolutionApiKey: editEvolutionApiKey.trim() || null,
          evolutionInstance: editEvolutionInstance.trim() || null,
        },
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const toggleSipPanel = async (device: WavoipDeviceRow) => {
    if (sipPanelId === device.id) {
      setSipPanelId(null);
      setSipInfo(null);
      return;
    }
    setSipPanelId(device.id);
    setSipInfo(null);
    setSipLoading(true);
    try {
      const info = await api.get<SipInfo>(`/settings/wavoip/devices/${device.id}/sip`);
      setSipInfo(info);
    } catch {
      setError(t("wavoip.sipLoadError"));
      setSipPanelId(null);
    } finally {
      setSipLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-ink-50">{t("wavoip.title")}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-ink-400">{t("wavoip.subtitle")}</p>
        <a
          href="https://app.wavoip.com/"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t("wavoip.panelLink")}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {createdSecret && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/80 p-4 text-sm dark:border-brand-900/50 dark:bg-brand-950/30">
          <p className="font-semibold text-brand-900 dark:text-brand-100">{t("wavoip.webhookSecretTitle")}</p>
          <p className="mt-1 font-mono text-xs break-all">{createdSecret}</p>
          <p className="mt-2 text-xs text-brand-800 dark:text-brand-200">{t("wavoip.webhookSecretHint")}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
        {t("wavoip.messagingNote")}
      </div>

      <WavoipMetricsPanel />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          {t("wavoip.addDevice")}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900">
          <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-ink-50">{t("wavoip.newDevice")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-ink-300">{t("wavoip.fieldName")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700 dark:text-ink-300">{t("wavoip.fieldToken")}</span>
              <input
                value={deviceToken}
                onChange={(e) => setDeviceToken(e.target.value)}
                placeholder={t("wavoip.fieldTokenHint")}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm dark:border-ink-700 dark:bg-ink-950"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-ink-300">{t("wavoip.fieldMode")}</span>
              <select
                value={connectionMode}
                onChange={(e) => setConnectionMode(e.target.value as (typeof CONNECTION_MODES)[number])}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              >
                {CONNECTION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`wavoip.mode.${m}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-ink-300">{t("wavoip.fieldInbox")}</span>
              <select
                value={inboxId}
                onChange={(e) => setInboxId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              >
                <option value="">{t("wavoip.fieldInboxNone")}</option>
                {inboxes.map((ib) => (
                  <option key={ib.id} value={ib.id}>
                    {ib.name}
                    {ib.isDefault ? ` (${t("wavoip.inboxDefault")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={saving || !name.trim() || !deviceToken.trim()}
              onClick={() => void createDevice()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("wavoip.saveDevice")}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-ink-700"
            >
              {t("wavoip.cancel")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500 dark:border-ink-700 dark:text-ink-400">
          {t("wavoip.empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {devices.map((device) => {
            const bridgeHints = BRIDGE_HINTS[device.connectionMode] ?? [];
            const isEditing = editingId === device.id;
            const sipOpen = sipPanelId === device.id;

            return (
              <div
                key={device.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Phone className="h-4 w-4 text-brand-600" />
                      <h3 className="font-semibold text-slate-900 dark:text-ink-50">{device.name}</h3>
                      <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", statusBadgeClass(device.status))}>
                        {t(`wavoip.status.${device.status}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-ink-400">
                      {t(`wavoip.mode.${device.connectionMode}`)}
                      {device.linkedPhone ? ` · ${device.linkedPhone}` : ""}
                      {device.inboxName ? ` · ${device.inboxName}` : ""}
                    </p>
                    {device.lastError && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{device.lastError}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => (isEditing ? setEditingId(null) : startEdit(device))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-ink-700 dark:hover:bg-ink-800"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      {t("wavoip.editDevice")}
                    </button>
                    {device.connectionMode === "QR_NATIVE" && (
                      <Link
                        to={`/settings/wavoip/${device.id}/qr`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-ink-700 dark:hover:bg-ink-800"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        {t("wavoip.openQr")}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => void copyWebhook(device)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-ink-700 dark:hover:bg-ink-800"
                    >
                      {copiedId === device.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {t("wavoip.copyWebhook")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteDevice(device.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("wavoip.delete")}
                    </button>
                  </div>
                </div>

                <p className="mt-3 break-all font-mono text-[11px] text-slate-400 dark:text-ink-500">{device.webhookUrl}</p>
                <p className="mt-2 text-[11px] text-slate-400 dark:text-ink-500">{t("wavoip.webhookHint")}</p>

                {bridgeHints.length > 0 && (
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-xs dark:border-ink-800 dark:bg-ink-950/50">
                    <p className="font-semibold text-slate-800 dark:text-ink-200">{t("wavoip.bridgeTitle")}</p>
                    <p className="mt-1 text-slate-600 dark:text-ink-400">{t("wavoip.bridgeHint")}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600 dark:text-ink-400">
                      {bridgeHints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <WavoipIncomingQueuePanel
                  deviceId={device.id}
                  initialMode={device.incomingQueue?.mode ?? "all"}
                  initialTeamId={device.incomingQueue?.teamId ?? null}
                  initialAssignedUserId={device.assignedUserId}
                  users={users}
                  teams={teams}
                  onSaved={() => void load()}
                />

                <WavoipEvolutionBridgePanel
                  deviceId={device.id}
                  connectionMode={device.connectionMode}
                  inboxId={device.inboxId}
                  inboxName={device.inboxName}
                  bridgeStatus={device.bridgeStatus}
                  onUpdated={load}
                />

                <WavoipOutboundIntegrationsPanel
                  deviceId={device.id}
                  integrations={device.outboundIntegrations ?? {}}
                  onUpdated={load}
                />

                {isEditing && (
                  <div className="mt-4 grid gap-3 rounded-lg border border-brand-100 bg-brand-50/40 p-4 dark:border-brand-900/30 dark:bg-brand-950/20">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editSipEnabled}
                        onChange={(e) => setEditSipEnabled(e.target.checked)}
                      />
                      <span>{t("wavoip.fieldSipEnabled")}</span>
                    </label>
                    {(device.connectionMode === "EXTERNAL_EVOLUTION" || editEvolutionUrl || editEvolutionInstance) && (
                      <>
                        <label className="block text-sm">
                          <span className="font-medium">{t("wavoip.fieldEvolutionUrl")}</span>
                          <input
                            value={editEvolutionUrl}
                            onChange={(e) => setEditEvolutionUrl(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="font-medium">{t("wavoip.fieldEvolutionApiKey")}</span>
                          <input
                            type="password"
                            value={editEvolutionApiKey}
                            onChange={(e) => setEditEvolutionApiKey(e.target.value)}
                            placeholder={device.externalConfig?.evolutionApiKey ? "••••••••" : ""}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="font-medium">{t("wavoip.fieldEvolutionInstance")}</span>
                          <input
                            value={editEvolutionInstance}
                            onChange={(e) => setEditEvolutionInstance(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
                          />
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveEdit(device.id)}
                      className="inline-flex w-fit items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("wavoip.saveChanges")}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void toggleSipPanel(device)}
                  className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  {sipOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {t("wavoip.sipTitle")}
                </button>

                {sipOpen && (
                  <div className="mt-3 rounded-lg border border-slate-100 p-4 text-sm dark:border-ink-800">
                    {sipLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
                    ) : !sipInfo?.sipEnabled ? (
                      <p className="text-slate-600 dark:text-ink-400">{t("wavoip.sipDisabled")}</p>
                    ) : (
                      <div className="space-y-4">
                        {sipInfo.methods.map((method) => (
                          <div key={method.id} className="space-y-2">
                            <p className="font-semibold text-slate-900 dark:text-ink-50">{method.label}</p>
                            {(["username", "password", "callerId"] as const).map((field) => (
                              <div key={field} className="flex flex-wrap items-center gap-2">
                                <span className="w-20 text-xs uppercase text-slate-500">{field}</span>
                                <code className="flex-1 break-all rounded bg-slate-100 px-2 py-1 text-xs dark:bg-ink-950">
                                  {method[field]}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => void copyText(`${method.id}-${field}`, method[field])}
                                  className="text-xs font-semibold text-brand-600"
                                >
                                  {copiedField === `${method.id}-${field}` ? t("wavoip.copyField") + " ✓" : t("wavoip.copyField")}
                                </button>
                              </div>
                            ))}
                            <p className="text-xs text-slate-500 dark:text-ink-400">{method.note}</p>
                          </div>
                        ))}
                        <a
                          href={sipInfo.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                        >
                          {t("wavoip.sipDocs")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
