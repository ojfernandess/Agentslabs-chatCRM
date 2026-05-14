import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  Settings,
  Wifi,
  WifiOff,
  Copy,
  Check,
  UserPlus,
  Bell,
  Tag,
  Smartphone,
  MessageCircle,
  Pencil,
  Star,
  FileText,
  GitBranch,
  Sparkles,
} from "lucide-react";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import {
  createEmbeddedSignupMessageHandler,
  initWhatsAppEmbeddedSignup,
  isValidEmbeddedBusinessData,
  setupFacebookSdk,
} from "@/lib/whatsappEmbeddedSdk";
import clsx from "clsx";

type SettingsSection =
  | "channel"
  | "notifications"
  | "csat"
  | "workflow"
  | "assistant"
  | "crm"
  | "templates"
  | "team";

interface AppSettings {
  whatsappProvider: string | null;
  whatsappApiKey: string | null;
  whatsappPhoneNumberId: string | null;
  evolutionApiBaseUrl: string | null;
  whatsappWebhookSecret: string | null;
  autoOptInOnFirstMessage: boolean;
  lockSingleConversation: boolean;
  audioTranscriptionEnabled?: boolean;
  silentTransferToAgentBot?: boolean;
  notifyConversationOpen: boolean;
  notifyConversationPending: boolean;
  webhookUrl: string;
  agentBotId?: string | null;
  csatEnabled: boolean;
  csatSurveyMessage: string | null;
  evolutionPlatformQrMode?: boolean;
  autoResolveConversationsEnabled?: boolean;
  autoResolveInactivityMinutes?: number;
  autoResolveCustomerMessage?: string | null;
  autoResolveSkipWhenAssigned?: boolean;
  autoResolveTagId?: string | null;
  autoResolveLeadTypeId?: string | null;
  resolveRequireClosureReason?: boolean;
  resolveRequireLeadType?: boolean;
  assistantOpenaiApiKey?: string | null;
  assistantOpenaiApiBaseUrl?: string | null;
}

interface AgentBotOption {
  id: string;
  name: string;
}

interface WhatsappEmbeddedTenantInfo {
  available: boolean;
  appId: string | null;
  configurationId: string | null;
  apiVersion: string | null;
  orgWebhookUrl: string;
}

interface LeadTypeRow {
  id: string;
  name: string;
  color: string;
  order: number;
  valueRollup: "PIPELINE" | "WON" | "LOST" | "NONE";
}

const LEAD_ROLLUP_LABEL_KEY: Record<LeadTypeRow["valueRollup"], string> = {
  PIPELINE: "settings.leadTypeRollupLabel_PIPELINE",
  WON: "settings.leadTypeRollupLabel_WON",
  LOST: "settings.leadTypeRollupLabel_LOST",
  NONE: "settings.leadTypeRollupLabel_NONE",
};

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  createdAt: string;
}

interface TagListRow {
  id: string;
  name: string;
  color: string;
}

/** Estágios do pipeline principal (Negócios / Novo negócio) — podem existir sem `leadType` após apagar tipo. */
interface CrmPipelineStageRow {
  id: string;
  name: string;
  color: string;
  order: number;
  leadType: { id: string; valueRollup: string } | null;
}

function workflowMinutesFromInput(n: number, u: "minutes" | "hours" | "days"): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 10;
  if (u === "days") return Math.min(v, 30) * 1440;
  if (u === "hours") return Math.min(v, 720) * 60;
  return Math.min(v, 43_200);
}

function workflowDisplayFromMinutes(total: number): { n: number; u: "minutes" | "hours" | "days" } {
  const m = Math.min(43_200, Math.max(1, Math.floor(Number(total)) || 10));
  if (m >= 1440 && m % 1440 === 0) return { n: m / 1440, u: "days" };
  if (m >= 60 && m % 60 === 0) return { n: m / 60, u: "hours" };
  return { n: m, u: "minutes" };
}

export function SettingsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [section, setSection] = useState<SettingsSection>("channel");
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const effectiveOrgId = user?.actingOrganizationId ?? user?.organizationId ?? null;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [evolutionBaseUrl, setEvolutionBaseUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [autoOptIn, setAutoOptIn] = useState(false);
  const [lockSingleConversation, setLockSingleConversation] = useState(false);
  const [audioTranscriptionEnabled, setAudioTranscriptionEnabled] = useState(false);
  const [silentTransferToAgentBot, setSilentTransferToAgentBot] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(true);
  const [notifyPending, setNotifyPending] = useState(true);
  const [csatEnabled, setCsatEnabled] = useState(false);
  const [csatSurveyMessage, setCsatSurveyMessage] = useState("");

  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [userFormError, setUserFormError] = useState("");
  const [userFormSubmitting, setUserFormSubmitting] = useState(false);

  const [leadTypes, setLeadTypes] = useState<LeadTypeRow[]>([]);
  const [newLtName, setNewLtName] = useState("");
  const [newLtColor, setNewLtColor] = useState("#6366f1");
  const [newLtRollup, setNewLtRollup] = useState<LeadTypeRow["valueRollup"]>("PIPELINE");
  const [ltError, setLtError] = useState("");
  const [ltSubmitting, setLtSubmitting] = useState(false);
  const [editingLtId, setEditingLtId] = useState<string | null>(null);
  const [editLtName, setEditLtName] = useState("");
  const [editLtColor, setEditLtColor] = useState("#6366f1");
  const [editLtRollup, setEditLtRollup] = useState<LeadTypeRow["valueRollup"]>("PIPELINE");
  const [editLtSubmitting, setEditLtSubmitting] = useState(false);
  const [pipelineOrphans, setPipelineOrphans] = useState<CrmPipelineStageRow[]>([]);
  const [orphanBusyId, setOrphanBusyId] = useState<string | null>(null);

  const [agentBotOptions, setAgentBotOptions] = useState<AgentBotOption[]>([]);
  const [agentBotId, setAgentBotId] = useState("");

  const [evoTplName, setEvoTplName] = useState("");
  const [evoTplCategory, setEvoTplCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [evoTplLanguage, setEvoTplLanguage] = useState("pt_BR");
  const [evoTplBody, setEvoTplBody] = useState("");
  const [evoTplFooter, setEvoTplFooter] = useState("");
  const [evoTplBusy, setEvoTplBusy] = useState(false);
  const [evoTplError, setEvoTplError] = useState("");
  const [evoTplSuccess, setEvoTplSuccess] = useState(false);

  const [workflowTags, setWorkflowTags] = useState<TagListRow[]>([]);
  const [wfAutoEnabled, setWfAutoEnabled] = useState(false);
  const [wfInactivityValue, setWfInactivityValue] = useState(10);
  const [wfInactivityUnit, setWfInactivityUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [wfCustomerMessage, setWfCustomerMessage] = useState("");
  const [wfSkipWhenAssigned, setWfSkipWhenAssigned] = useState(false);
  const [wfTagId, setWfTagId] = useState("");
  const [wfAutoLeadTypeId, setWfAutoLeadTypeId] = useState("");
  const [wfRequireClosure, setWfRequireClosure] = useState(true);
  const [wfRequireLeadType, setWfRequireLeadType] = useState(true);
  const [workflowError, setWorkflowError] = useState("");

  const [assistantOpenaiKey, setAssistantOpenaiKey] = useState("");
  const [assistantOpenaiBaseUrl, setAssistantOpenaiBaseUrl] = useState("");
  const [assistantSaveError, setAssistantSaveError] = useState("");

  const [embeddedInfo, setEmbeddedInfo] = useState<WhatsappEmbeddedTenantInfo | null>(null);
  const [embeddedBusy, setEmbeddedBusy] = useState(false);
  const [embeddedError, setEmbeddedError] = useState("");
  const [embeddedSuccess, setEmbeddedSuccess] = useState(false);
  const authCodeRef = useRef<string | null>(null);

  const [evolutionPlatformQrMode, setEvolutionPlatformQrMode] = useState(false);
  const [evoQrBusy, setEvoQrBusy] = useState(false);
  const [evoQrError, setEvoQrError] = useState("");
  const [evoQrNewInstanceName, setEvoQrNewInstanceName] = useState("");
  const [evoQrWebhookWarn, setEvoQrWebhookWarn] = useState(false);
  const [evoQrDataUrl, setEvoQrDataUrl] = useState<string | null>(null);
  const [evoPairingCode, setEvoPairingCode] = useState<string | null>(null);
  const [evoConnPoll, setEvoConnPoll] = useState<{ connected: boolean; state: string } | null>(null);
  const [evoGoBusy, setEvoGoBusy] = useState(false);
  const [evoGoError, setEvoGoError] = useState("");
  const [evoGoInstances, setEvoGoInstances] = useState<Array<{ id: string; name: string; connected: boolean }> | null>(
    null,
  );
  const [evoGoConnectOk, setEvoGoConnectOk] = useState<boolean | null>(null);
  const businessDataRef = useRef<{
    business_id: string;
    waba_id: string;
    phone_number_id?: string;
  } | null>(null);

  const tryFinishEmbedded = useCallback(async () => {
    const code = authCodeRef.current;
    const bd = businessDataRef.current;
    if (!code || !bd || !isValidEmbeddedBusinessData(bd)) return;
    setEmbeddedBusy(true);
    setEmbeddedError("");
    try {
      await api.post("/settings/whatsapp-embedded/complete", {
        code,
        business_id: bd.business_id,
        waba_id: bd.waba_id,
        phone_number_id: bd.phone_number_id || undefined,
      });
      authCodeRef.current = null;
      businessDataRef.current = null;
      setEmbeddedSuccess(true);
      const data = await api.get<AppSettings>("/settings");
      setSettings(data);
      setProvider("meta");
      setPhoneNumberId(data.whatsappPhoneNumberId ?? "");
      setApiKey("");
    } catch (err) {
      authCodeRef.current = null;
      businessDataRef.current = null;
      setEmbeddedError(err instanceof Error ? err.message : t("settings.embeddedCompleteError"));
    } finally {
      setEmbeddedBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isAdmin || !embeddedInfo?.available) return;
    const handler = createEmbeddedSignupMessageHandler((data) => {
      if (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        const bd = data.data;
        if (!isValidEmbeddedBusinessData(bd)) {
          setEmbeddedError(t("settings.embeddedInvalidBusiness"));
          return;
        }
        businessDataRef.current = bd;
        void tryFinishEmbedded();
      } else if (data.event === "CANCEL") {
        setEmbeddedBusy(false);
      } else if (data.event === "error") {
        setEmbeddedBusy(false);
        setEmbeddedError(data.error_message ?? t("settings.embeddedSignupError"));
      }
    });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isAdmin, embeddedInfo?.available, tryFinishEmbedded, t]);

  useEffect(() => {
    if (provider !== "evolution") {
      setEvoQrDataUrl(null);
      setEvoPairingCode(null);
      setEvoQrError("");
      setEvoQrNewInstanceName("");
      setEvoQrWebhookWarn(false);
    }
  }, [provider]);

  useEffect(() => {
    if (provider !== "evolution_go") {
      setEvoGoError("");
      setEvoGoInstances(null);
      setEvoGoConnectOk(null);
    }
  }, [provider]);

  useEffect(() => {
    if (!isAdmin || !evolutionPlatformQrMode || provider !== "evolution") {
      setEvoConnPoll(null);
      return;
    }
    const tick = () => {
      void api
        .get<{ connected: boolean; state: string }>("/settings/evolution-qr/status")
        .then((s) => setEvoConnPoll({ connected: s.connected, state: s.state }))
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [isAdmin, evolutionPlatformQrMode, provider]);

  const startEvolutionQr = async () => {
    setEvoQrBusy(true);
    setEvoQrError("");
    try {
      const r = await api.post<{
        instanceName: string;
        pairingCode: string | null;
        qrDataUrl: string | null;
        connectionState: string;
        connected: boolean;
      }>("/settings/evolution-qr/start", {});
      setPhoneNumberId(r.instanceName);
      setProvider("evolution");
      setEvoPairingCode(r.pairingCode);
      setEvoQrDataUrl(r.qrDataUrl);
      setEvoConnPoll({ connected: r.connected, state: r.connectionState });
      const data = await api.get<AppSettings>("/settings");
      setSettings(data);
      setEvolutionPlatformQrMode(data.evolutionPlatformQrMode ?? false);
    } catch (err) {
      setEvoQrError(err instanceof Error ? err.message : t("settings.evolutionQrError"));
    } finally {
      setEvoQrBusy(false);
    }
  };

  const refreshEvolutionQr = async () => {
    setEvoQrBusy(true);
    setEvoQrError("");
    try {
      const r = await api.get<{
        instanceName: string;
        pairingCode: string | null;
        qrDataUrl: string | null;
      }>("/settings/evolution-qr/qr");
      setEvoPairingCode(r.pairingCode);
      setEvoQrDataUrl(r.qrDataUrl);
    } catch (err) {
      setEvoQrError(err instanceof Error ? err.message : t("settings.evolutionQrError"));
    } finally {
      setEvoQrBusy(false);
    }
  };

  const fetchEvolutionGoInstances = async () => {
    setEvoGoBusy(true);
    setEvoGoError("");
    try {
      const r = await api.get<{ instances: Array<{ id: string; name: string; connected: boolean }> }>(
        "/settings/evolution-go/instances",
      );
      setEvoGoInstances(r.instances);
    } catch (err) {
      setEvoGoError(err instanceof Error ? err.message : "Falha ao buscar instâncias do Evolution Go");
    } finally {
      setEvoGoBusy(false);
    }
  };

  const connectEvolutionGoWebhook = async () => {
    setEvoGoBusy(true);
    setEvoGoError("");
    setEvoGoConnectOk(null);
    try {
      await api.post("/settings/evolution-go/connect", {});
      setEvoGoConnectOk(true);
    } catch (err) {
      setEvoGoConnectOk(false);
      setEvoGoError(err instanceof Error ? err.message : "Falha ao conectar e configurar webhook no Evolution Go");
    } finally {
      setEvoGoBusy(false);
    }
  };

  const launchEmbeddedSignup = async () => {
    if (!embeddedInfo?.appId || !embeddedInfo.configurationId || !embeddedInfo.apiVersion) return;
    setEmbeddedError("");
    setEmbeddedSuccess(false);
    setEmbeddedBusy(true);
    authCodeRef.current = null;
    businessDataRef.current = null;
    try {
      await setupFacebookSdk(embeddedInfo.appId, embeddedInfo.apiVersion);
      const code = await initWhatsAppEmbeddedSignup(embeddedInfo.configurationId);
      authCodeRef.current = code;
      if (businessDataRef.current) {
        await tryFinishEmbedded();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "Login cancelled") {
        setEmbeddedError(msg);
      }
    } finally {
      setEmbeddedBusy(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    async function load() {
      try {
        const [data, users, lt, tags, botList, emb] = await Promise.all([
          api.get<AppSettings>("/settings"),
          api.get<TeamUser[]>("/users"),
          api.get<LeadTypeRow[]>("/lead-types"),
          api.get<TagListRow[]>("/tags").catch(() => [] as TagListRow[]),
          api.get<{ data: AgentBotOption[] }>("/bots").catch(() => ({ data: [] as AgentBotOption[] })),
          api.get<WhatsappEmbeddedTenantInfo>("/settings/whatsapp-embedded").catch(() => null),
        ]);
        setEmbeddedInfo(emb ?? null);
        setSettings(data);
        setProvider(data.whatsappProvider ?? "");
        setPhoneNumberId(data.whatsappPhoneNumberId ?? "");
        setEvolutionPlatformQrMode(data.evolutionPlatformQrMode ?? false);
        if (data.whatsappProvider === "evolution" && (data.evolutionPlatformQrMode ?? false)) {
          setEvoQrNewInstanceName(data.whatsappPhoneNumberId ?? "");
        } else {
          setEvoQrNewInstanceName("");
        }
        setEvolutionBaseUrl(data.evolutionApiBaseUrl ?? "");
        setAutoOptIn(data.autoOptInOnFirstMessage);
        setLockSingleConversation(data.lockSingleConversation ?? false);
        setAudioTranscriptionEnabled(data.audioTranscriptionEnabled ?? false);
        setSilentTransferToAgentBot(data.silentTransferToAgentBot ?? false);
        setNotifyOpen(data.notifyConversationOpen ?? true);
        setNotifyPending(data.notifyConversationPending ?? true);
        setCsatEnabled(data.csatEnabled ?? false);
        setCsatSurveyMessage(data.csatSurveyMessage ?? "");
        setWorkflowTags(tags);
        setWfAutoEnabled(data.autoResolveConversationsEnabled ?? false);
        const disp = workflowDisplayFromMinutes(data.autoResolveInactivityMinutes ?? 10);
        setWfInactivityValue(disp.n);
        setWfInactivityUnit(disp.u);
        setWfCustomerMessage(data.autoResolveCustomerMessage ?? "");
        setWfSkipWhenAssigned(data.autoResolveSkipWhenAssigned ?? false);
        setWfTagId(data.autoResolveTagId ?? "");
        setWfAutoLeadTypeId(data.autoResolveLeadTypeId ?? "");
        setWfRequireClosure(data.resolveRequireClosureReason ?? true);
        setWfRequireLeadType(data.resolveRequireLeadType ?? true);
        setWorkflowError("");
        setAssistantOpenaiKey("");
        setAssistantOpenaiBaseUrl(data.assistantOpenaiApiBaseUrl ?? "");
        setAssistantSaveError("");
        setAgentBotId(data.agentBotId ?? "");
        setAgentBotOptions(botList.data.map((b) => ({ id: b.id, name: b.name })));
        setTeamUsers(users);
        setLeadTypes(
          lt.map((x) => ({
            ...x,
            valueRollup: (x as LeadTypeRow).valueRollup ?? "PIPELINE",
          })),
        );
        try {
          const pst = await api.get<CrmPipelineStageRow[]>("/crm/pipeline-stages");
          setPipelineOrphans(pst.filter((s) => !s.leadType));
        } catch {
          setPipelineOrphans([]);
        }
      } catch {
        // failed
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isAdmin]);

  const refreshLeadTypesAndPipelineOrphans = async () => {
    const lt = await api.get<LeadTypeRow[]>("/lead-types");
    setLeadTypes(
      lt.map((x) => ({
        ...x,
        valueRollup: (x as LeadTypeRow).valueRollup ?? "PIPELINE",
      })),
    );
    try {
      const pst = await api.get<CrmPipelineStageRow[]>("/crm/pipeline-stages");
      setPipelineOrphans(pst.filter((s) => !s.leadType));
    } catch {
      setPipelineOrphans([]);
    }
  };

  const handleAddLeadType = async (e: FormEvent) => {
    e.preventDefault();
    setLtError("");
    if (!newLtName.trim()) return;
    setLtSubmitting(true);
    try {
      const nextOrder =
        leadTypes.length === 0 ? 0 : Math.max(...leadTypes.map((l) => l.order)) + 1;
      await api.post<LeadTypeRow>("/lead-types", {
        name: newLtName.trim(),
        color: newLtColor,
        order: nextOrder,
        valueRollup: newLtRollup,
      });
      setNewLtName("");
      setNewLtColor("#6366f1");
      setNewLtRollup("PIPELINE");
      await refreshLeadTypesAndPipelineOrphans();
    } catch (err) {
      setLtError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLtSubmitting(false);
    }
  };

  const handleCreateLeadFromOrphanStage = async (stage: CrmPipelineStageRow) => {
    setLtError("");
    setOrphanBusyId(stage.id);
    try {
      await api.post<LeadTypeRow>("/lead-types", {
        name: stage.name,
        color: stage.color,
        order: stage.order,
        valueRollup: "PIPELINE",
      });
      await refreshLeadTypesAndPipelineOrphans();
    } catch (err) {
      setLtError(err instanceof Error ? err.message : "Failed");
    } finally {
      setOrphanBusyId(null);
    }
  };

  const handleDeleteLeadType = async (id: string) => {
    setLtError("");
    try {
      await api.delete(`/lead-types/${id}`);
      await refreshLeadTypesAndPipelineOrphans();
    } catch (err) {
      setLtError(err instanceof Error ? err.message : "Failed");
    }
  };

  const startEditLeadType = (lt: LeadTypeRow) => {
    setEditingLtId(lt.id);
    setEditLtName(lt.name);
    setEditLtColor(lt.color);
    setEditLtRollup(lt.valueRollup ?? "PIPELINE");
    setLtError("");
  };

  const cancelEditLeadType = () => {
    setEditingLtId(null);
    setLtError("");
  };

  const handleSaveEditLeadType = async (e: FormEvent, id: string) => {
    e.preventDefault();
    setLtError("");
    const row = leadTypes.find((l) => l.id === id);
    if (!row || !editLtName.trim()) return;
    setEditLtSubmitting(true);
    try {
      await api.put<LeadTypeRow>(`/lead-types/${id}`, {
        name: editLtName.trim(),
        color: editLtColor,
        order: row.order,
        valueRollup: editLtRollup,
      });
      setEditingLtId(null);
      await refreshLeadTypesAndPipelineOrphans();
    } catch (err) {
      setLtError(err instanceof Error ? err.message : "Failed");
    } finally {
      setEditLtSubmitting(false);
    }
  };

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
      const users = await api.get<TeamUser[]>("/users");
      setTeamUsers(users);
    } catch (err) {
      setUserFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setUserFormSubmitting(false);
    }
  };

  const handleSaveWorkflow = async (e: FormEvent) => {
    e.preventDefault();
    setWorkflowError("");
    setSaving(true);
    try {
      const minutes = workflowMinutesFromInput(wfInactivityValue, wfInactivityUnit);
      const data = await api.put<AppSettings>("/settings", {
        autoResolveConversationsEnabled: wfAutoEnabled,
        autoResolveInactivityMinutes: minutes,
        autoResolveCustomerMessage: wfCustomerMessage.trim() || null,
        autoResolveSkipWhenAssigned: wfSkipWhenAssigned,
        autoResolveTagId: wfTagId.trim() || null,
        autoResolveLeadTypeId: wfAutoLeadTypeId.trim() || null,
        resolveRequireClosureReason: wfRequireClosure,
        resolveRequireLeadType: wfRequireLeadType,
      });
      setSettings(data);
      setWfAutoEnabled(data.autoResolveConversationsEnabled ?? false);
      const disp = workflowDisplayFromMinutes(data.autoResolveInactivityMinutes ?? 10);
      setWfInactivityValue(disp.n);
      setWfInactivityUnit(disp.u);
      setWfCustomerMessage(data.autoResolveCustomerMessage ?? "");
      setWfSkipWhenAssigned(data.autoResolveSkipWhenAssigned ?? false);
      setWfTagId(data.autoResolveTagId ?? "");
      setWfAutoLeadTypeId(data.autoResolveLeadTypeId ?? "");
      setWfRequireClosure(data.resolveRequireClosureReason ?? true);
      setWfRequireLeadType(data.resolveRequireLeadType ?? true);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : t("settings.workflowSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCsat = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await api.put<AppSettings>("/settings", {
        csatEnabled,
        csatSurveyMessage: csatSurveyMessage.trim() || null,
      });
      setSettings(data);
      setCsatEnabled(data.csatEnabled ?? false);
      setCsatSurveyMessage(data.csatSurveyMessage ?? "");
    } catch {
      /* failed */
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAssistant = async (e: FormEvent) => {
    e.preventDefault();
    setAssistantSaveError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        assistantOpenaiApiBaseUrl: assistantOpenaiBaseUrl.trim() || null,
      };
      if (assistantOpenaiKey.trim()) {
        body.assistantOpenaiApiKey = assistantOpenaiKey.trim();
      }
      const data = await api.put<AppSettings>("/settings", body);
      setSettings(data);
      setAssistantOpenaiKey("");
      setAssistantOpenaiBaseUrl(data.assistantOpenaiApiBaseUrl ?? "");
    } catch (err) {
      setAssistantSaveError(err instanceof Error ? err.message : t("settings.assistantSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveOrgAssistantKey = async () => {
    if (!window.confirm(t("settings.assistantRemoveKeyConfirm"))) return;
    setAssistantSaveError("");
    setSaving(true);
    try {
      const data = await api.put<AppSettings>("/settings", { assistantOpenaiApiKey: null });
      setSettings(data);
      setAssistantOpenaiKey("");
      setAssistantOpenaiBaseUrl(data.assistantOpenaiApiBaseUrl ?? "");
    } catch (err) {
      setAssistantSaveError(err instanceof Error ? err.message : t("settings.assistantSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await api.put<AppSettings>("/settings", {
        notifyConversationOpen: notifyOpen,
        notifyConversationPending: notifyPending,
      });
      setSettings(data);
      setNotifyOpen(data.notifyConversationOpen ?? true);
      setNotifyPending(data.notifyConversationPending ?? true);
    } catch {
      /* failed */
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        autoOptInOnFirstMessage: autoOptIn,
        lockSingleConversation,
        audioTranscriptionEnabled,
        silentTransferToAgentBot,
      };
      if (provider) body.whatsappProvider = provider;
      if (!(evolutionPlatformQrMode && provider === "evolution")) {
        if (apiKey) body.whatsappApiKey = apiKey;
      }
      if (phoneNumberId) body.whatsappPhoneNumberId = phoneNumberId;
      if (webhookSecret) body.whatsappWebhookSecret = webhookSecret;
      if (provider === "evolution" && !evolutionPlatformQrMode) {
        body.evolutionApiBaseUrl = evolutionBaseUrl.trim() || null;
      } else if (provider === "evolution_go") {
        body.evolutionApiBaseUrl = evolutionBaseUrl.trim() || null;
      } else if (provider && provider !== "evolution" && provider !== "evolution_go") {
        body.evolutionApiBaseUrl = null;
      }
      body.agentBotId = agentBotId.trim() ? agentBotId.trim() : null;

      const data = await api.put<AppSettings>("/settings", body);
      setSettings(data);
      setEvolutionPlatformQrMode(data.evolutionPlatformQrMode ?? false);
      setApiKey("");
      setWebhookSecret("");
      setEvolutionBaseUrl(data.evolutionApiBaseUrl ?? "");
      setAgentBotId(data.agentBotId ?? "");
      setLockSingleConversation(data.lockSingleConversation ?? false);
      setAudioTranscriptionEnabled(data.audioTranscriptionEnabled ?? false);
      setSilentTransferToAgentBot(data.silentTransferToAgentBot ?? false);
    } catch {
      // failed
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ connected: boolean }>("/settings/test-connection");
      setTestResult(result.connected);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  };

  const submitEvolutionTemplate = async (e: FormEvent) => {
    e.preventDefault();
    if (provider !== "evolution") {
      setEvoTplError(t("settings.evoTplWrongProvider"));
      return;
    }
    setEvoTplBusy(true);
    setEvoTplError("");
    setEvoTplSuccess(false);
    try {
      await api.post("/templates/evolution", {
        name: evoTplName.trim(),
        category: evoTplCategory,
        language: evoTplLanguage.trim(),
        body: evoTplBody.trim(),
        ...(evoTplFooter.trim() ? { footer: evoTplFooter.trim() } : {}),
      });
      setEvoTplSuccess(true);
      setEvoTplName("");
      setEvoTplBody("");
      setEvoTplFooter("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("settings.evoTplFailed");
      setEvoTplError(msg);
    } finally {
      setEvoTplBusy(false);
    }
  };

  const webhookDisplay =
    settings?.webhookUrl ??
    (effectiveOrgId ? `${window.location.origin}/webhooks/whatsapp/${effectiveOrgId}` : "");

  const copyWebhookUrl = () => {
    if (webhookDisplay) {
      navigator.clipboard.writeText(webhookDisplay);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const assistantKeyMasked = settings?.assistantOpenaiApiKey === "••••••••";

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">{t("common.adminRequired")}</p>
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
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 border-b border-gray-200 pb-6">
            <h1 className="text-2xl font-bold text-gray-900">{t("settings.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">{t("settings.subtitle")}</p>
          </div>

          <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
            <nav
              className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:gap-0.5 lg:overflow-visible"
              aria-label="Settings sections"
            >
              {(
                [
                  ["channel", t("settings.sectionChannel"), Smartphone],
                  ["notifications", t("settings.sectionNotifications"), Bell],
                  ["csat", t("settings.sectionCsat"), Star],
                  ["workflow", t("settings.sectionWorkflow"), GitBranch],
                  ["assistant", t("settings.sectionAssistant"), Sparkles],
                  ["crm", t("settings.sectionCrm"), Tag],
                  ["templates", t("settings.sectionTemplates"), FileText],
                  ["team", t("settings.sectionTeam"), UserPlus],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  className={clsx(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors",
                    section === id
                      ? "bg-white text-brand-800 shadow-sm ring-1 ring-gray-200"
                      : "text-gray-600 hover:bg-white/60 hover:text-gray-900",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0 text-gray-500" />
                  {label}
                </button>
              ))}
            </nav>

            <motion.div
              className="min-w-0 flex-1 space-y-8"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {section === "channel" && (
                <>
                  <motion.div
                    className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-brand-900"
                    variants={staggerItem}
                  >
                    <p className="font-medium">Configuração de provider WhatsApp unificada em Caixas de entrada.</p>
                    <p className="mt-1 text-brand-800/90">
                      Use a edição da inbox WhatsApp para Meta, 360dialog, Twilio e Evolution. Os fluxos rápidos continuam disponíveis aqui.
                    </p>
                    <a href="/inboxes" className="mt-2 inline-block font-medium text-brand-700 underline">
                      Abrir Caixas de entrada
                    </a>
                  </motion.div>
                  {embeddedInfo?.available ? (
                    <motion.div
                      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                      variants={staggerItem}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100">
                          <MessageCircle className="h-6 w-6 text-green-600" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">{t("settings.embeddedTitle")}</h2>
                            <p className="mt-1 text-sm text-gray-600">{t("settings.embeddedDesc")}</p>
                          </div>
                          <ul className="space-y-2 text-sm text-gray-700">
                            <li className="flex gap-2">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                              <span>{t("settings.embeddedBenefit1")}</span>
                            </li>
                            <li className="flex gap-2">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                              <span>{t("settings.embeddedBenefit2")}</span>
                            </li>
                            <li className="flex gap-2">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                              <span>{t("settings.embeddedBenefit3")}</span>
                            </li>
                          </ul>
                          {embeddedError ? (
                            <p className="text-sm text-red-600" role="alert">
                              {embeddedError}
                            </p>
                          ) : null}
                          {embeddedSuccess ? (
                            <p className="text-sm text-green-700">{t("settings.embeddedSuccess")}</p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void launchEmbeddedSignup()}
                            disabled={embeddedBusy}
                            className="w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:w-auto"
                          >
                            {embeddedBusy ? t("settings.embeddedWorking") : t("settings.embeddedCta")}
                          </button>
                          <p className="text-xs text-gray-500">
                            {t("settings.embeddedManualHint")}{" "}
                            <a
                              href="#whatsapp-manual-setup"
                              className="font-medium text-brand-600 underline hover:text-brand-700"
                            >
                              {t("settings.embeddedManualLink")}
                            </a>
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ) : embeddedInfo && !embeddedInfo.available ? (
                    <motion.div
                      className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
                      variants={staggerItem}
                    >
                      {t("settings.embeddedUnavailable")}
                    </motion.div>
                  ) : null}

                  <motion.div
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                    variants={staggerItem}
                  >
                    <p className="mb-4 text-sm text-gray-600">{t("settings.channelHint")}</p>
                    <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
                      <Settings className="h-5 w-5" />
                      Webhook URL
                    </h2>
                    <p className="mb-3 text-sm text-gray-500">{t("settings.webhookCopyHint")}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
                        {webhookDisplay || "—"}
                      </code>
                      <button
                        type="button"
                        onClick={copyWebhookUrl}
                        className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </motion.div>

                  <motion.form
                    id="whatsapp-manual-setup"
                    onSubmit={handleSave}
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                    variants={staggerItem}
                  >
                    <h2 className="mb-4 font-semibold text-gray-900">WhatsApp provider</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Provider</label>
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">Select provider...</option>
                          <option value="meta">Meta Cloud API</option>
                          <option value="360dialog">360dialog</option>
                          <option value="twilio">Twilio</option>
                          <option value="evolution">Evolution API</option>
                          <option value="evolution_go">Evolution Go</option>
                        </select>
                      </div>

                      {provider === "evolution" && evolutionPlatformQrMode ? (
                        <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/60 p-4">
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">{t("settings.evolutionQrTitle")}</h3>
                            <p className="mt-1 text-xs text-gray-600">{t("settings.evolutionQrSubtitle")}</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-800">
                              {t("settings.evolutionQrInstanceNameLabel")}
                            </label>
                            <input
                              type="text"
                              value={evoQrNewInstanceName}
                              onChange={(e) => setEvoQrNewInstanceName(e.target.value)}
                              disabled={evoQrBusy}
                              placeholder={t("settings.evolutionQrInstanceNamePlaceholder")}
                              autoComplete="off"
                              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
                            />
                            <p className="mt-1 text-xs text-gray-600">{t("settings.evolutionQrInstanceNameHint")}</p>
                          </div>
                          {evoConnPoll ? (
                            <p className="text-sm text-gray-800">
                              <span className="font-medium">{t("settings.evolutionQrState")}:</span>{" "}
                              {evoConnPoll.connected ? (
                                <span className="text-green-700">{t("settings.evolutionQrConnected")}</span>
                              ) : (
                                <span className="text-amber-800">
                                  {evoConnPoll.state || t("settings.evolutionQrNotConnected")}
                                </span>
                              )}
                            </p>
                          ) : null}
                          {phoneNumberId ? (
                            <p className="text-xs text-gray-600">
                              <span className="font-medium text-gray-800">{t("settings.evolutionQrInstance")}:</span>{" "}
                              <code className="rounded bg-white px-1.5 py-0.5">{phoneNumberId}</code>
                            </p>
                          ) : null}
                          {evoPairingCode ? (
                            <p className="text-xs text-gray-600">
                              <span className="font-medium text-gray-800">{t("settings.evolutionQrPairing")}:</span>{" "}
                              {evoPairingCode}
                            </p>
                          ) : null}
                          {evoQrWebhookWarn ? (
                            <p className="text-sm text-amber-800" role="status">
                              {t("settings.evolutionQrWebhookWarn")}
                            </p>
                          ) : null}
                          {evoQrError ? (
                            <p className="text-sm text-red-600" role="alert">
                              {evoQrError}
                            </p>
                          ) : null}
                          {evoQrDataUrl ? (
                            <div className="flex justify-center">
                              <img
                                src={evoQrDataUrl}
                                alt="WhatsApp QR"
                                className="h-56 w-56 rounded-lg border border-gray-200 bg-white p-2"
                                loading="lazy"
                                decoding="async"
                              />
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={evoQrBusy}
                              onClick={() => void startEvolutionQr()}
                              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                            >
                              {evoQrBusy ? t("settings.evolutionQrBusy") : t("settings.evolutionQrCta")}
                            </button>
                            {phoneNumberId ? (
                              <button
                                type="button"
                                disabled={evoQrBusy}
                                onClick={() => void refreshEvolutionQr()}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                              >
                                {t("settings.evolutionQrRefresh")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {(provider === "evolution" && !evolutionPlatformQrMode) || provider === "evolution_go" ? (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            {provider === "evolution_go" ? "Evolution Go base URL" : "Evolution API base URL"}
                          </label>
                          <input
                            type="url"
                            value={evolutionBaseUrl}
                            onChange={(e) => setEvolutionBaseUrl(e.target.value)}
                            placeholder={
                              provider === "evolution_go"
                                ? "https://evolution-go.example.com"
                                : "https://evolution.example.com"
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            {provider === "evolution_go" ? (
                              <>
                                Public URL of your Evolution Go server (no trailing path; uses routes such as{" "}
                                <code className="rounded bg-gray-100 px-1">/send/text</code>).
                              </>
                            ) : (
                              <>
                                Public URL of your Evolution API v2 server (no trailing path; uses REST routes such as{" "}
                                <code className="rounded bg-gray-100 px-1">/message/sendText/…</code>).
                              </>
                            )}
                          </p>
                        </div>
                      ) : null}

                      {!(provider === "evolution" && evolutionPlatformQrMode) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {provider === "evolution" ? "API key" : "API Key"}
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={settings?.whatsappApiKey ? "••••••••" : "Enter API key"}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        {provider === "evolution" && !evolutionPlatformQrMode && (
                          <p className="mt-1 text-xs text-gray-500">
                            Same value as Evolution&apos;s global API key env (often{" "}
                            <code className="rounded bg-gray-100 px-1">AUTHENTICATION_API_KEY</code>); sent as the{" "}
                            <code className="rounded bg-gray-100 px-1">apikey</code> header.
                          </p>
                        )}
                      </div>
                      )}

                      {!(provider === "evolution" && evolutionPlatformQrMode) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {provider === "evolution"
                            ? "Instance name"
                            : provider === "evolution_go"
                              ? "Instance ID"
                              : "Phone Number ID"}
                        </label>
                        <input
                          type="text"
                          value={phoneNumberId}
                          onChange={(e) => setPhoneNumberId(e.target.value)}
                          placeholder={
                            provider === "evolution"
                              ? "Instance name (as in /instance/create)"
                              : provider === "evolution_go"
                                ? "Instance UUID (as in /instance/all)"
                              : "Enter phone number ID"
                          }
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      )}

                      {provider === "evolution_go" ? (
                        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={evoGoBusy}
                              onClick={() => void fetchEvolutionGoInstances()}
                              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {evoGoBusy ? "Buscando..." : "Buscar instâncias"}
                            </button>
                            <button
                              type="button"
                              disabled={evoGoBusy}
                              onClick={() => void connectEvolutionGoWebhook()}
                              className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                            >
                              {evoGoBusy ? "Conectando..." : "Conectar e configurar webhook"}
                            </button>
                            {evoGoConnectOk === true ? (
                              <span className="text-sm text-green-700">Conectado</span>
                            ) : evoGoConnectOk === false ? (
                              <span className="text-sm text-red-600">Falha</span>
                            ) : null}
                          </div>

                          {evoGoError ? (
                            <p className="text-sm text-red-600" role="alert">
                              {evoGoError}
                            </p>
                          ) : null}

                          {evoGoInstances?.length ? (
                            <div className="max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white">
                              <ul className="divide-y divide-gray-100 text-sm">
                                {evoGoInstances.map((inst) => (
                                  <li key={inst.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                    <button
                                      type="button"
                                      onClick={() => setPhoneNumberId(inst.id)}
                                      className="text-left font-medium text-gray-900 hover:underline"
                                    >
                                      {inst.name}
                                    </button>
                                    <span className={inst.connected ? "text-green-700" : "text-amber-800"}>
                                      {inst.connected ? "connected" : "offline"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div>
                        <label className="block text-sm font-medium text-gray-700">Webhook secret</label>
                        <input
                          type="password"
                          value={webhookSecret}
                          onChange={(e) => setWebhookSecret(e.target.value)}
                          placeholder={
                            provider === "evolution"
                              ? "Optional — leave empty unless you add a custom header on Evolution"
                              : settings?.whatsappWebhookSecret
                                ? "••••••••"
                                : "Enter webhook secret"
                          }
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        {provider === "evolution" ? (
                          <p className="mt-1 text-xs text-gray-500">
                            <strong>Evolution does not supply this.</strong> Leave it empty for the usual setup —
                            webhooks work without it. For extra verification, invent any long random string, save it
                            here, then in Evolution configure the instance webhook <strong>headers</strong> (e.g. in
                            the webhook JSON or manager UI) with name{" "}
                            <code className="rounded bg-gray-100 px-1">x-openconduit-token</code> and value identical to
                            this field. If this field is filled, requests without that header are rejected with 401.
                          </p>
                        ) : provider === "evolution_go" ? (
                          <p className="mt-1 text-xs text-gray-500">
                            Optional verification for Evolution Go webhooks. If filled, incoming webhook payloads must
                            include an <code className="rounded bg-gray-100 px-1">instanceToken</code> equal to this
                            value (or a matching <code className="rounded bg-gray-100 px-1">x-openconduit-token</code>{" "}
                            header).
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-gray-500">
                            For Meta / 360dialog, use the app verify token / HMAC secret as documented for the Cloud API
                            webhook.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.agentBotWhatsApp")}
                        </label>
                        <select
                          value={agentBotId}
                          onChange={(e) => setAgentBotId(e.target.value)}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">{t("settings.agentBotNone")}</option>
                          {agentBotOptions.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t("settings.agentBotWhatsAppHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.lockSingleConversation")}
                        </label>
                        <select
                          value={lockSingleConversation ? "on" : "off"}
                          onChange={(e) => setLockSingleConversation(e.target.value === "on")}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="on">{t("settings.lockSingleConversationOn")}</option>
                          <option value="off">{t("settings.lockSingleConversationOff")}</option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t("settings.lockSingleConversationHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.audioTranscription")}
                        </label>
                        <select
                          value={audioTranscriptionEnabled ? "on" : "off"}
                          onChange={(e) => setAudioTranscriptionEnabled(e.target.value === "on")}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="on">{t("settings.audioTranscriptionOn")}</option>
                          <option value="off">{t("settings.audioTranscriptionOff")}</option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t("settings.audioTranscriptionHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.silentTransferToAgentBot")}
                        </label>
                        <select
                          value={silentTransferToAgentBot ? "on" : "off"}
                          onChange={(e) => setSilentTransferToAgentBot(e.target.value === "on")}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="on">{t("settings.silentTransferToAgentBotOn")}</option>
                          <option value="off">{t("settings.silentTransferToAgentBotOff")}</option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t("settings.silentTransferToAgentBotHint")}</p>
                      </div>

                      <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
                        <input
                          id="autoOptIn"
                          type="checkbox"
                          checked={autoOptIn}
                          onChange={(e) => setAutoOptIn(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                        />
                        <label htmlFor="autoOptIn" className="text-sm text-gray-700">
                          Auto opt-in contacts when they send the first message
                        </label>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save channel settings"}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleTestConnection()}
                        disabled={testing}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {testing ? (
                          "Testing..."
                        ) : testResult === true ? (
                          <>
                            <Wifi className="h-4 w-4 text-green-500" />
                            Connected
                          </>
                        ) : testResult === false ? (
                          <>
                            <WifiOff className="h-4 w-4 text-red-500" />
                            Failed
                          </>
                        ) : (
                          "Test Connection"
                        )}
                      </button>
                    </div>
                  </motion.form>
                </>
              )}

              {section === "notifications" && (
                <motion.form
                  onSubmit={(e) => void handleSaveNotifications(e)}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <Bell className="h-5 w-5" />
                    {t("settings.sectionNotifications")}
                  </h2>
                  <p className="mb-6 text-sm text-gray-500">
                    Controls the sidebar bell badge and desktop notifications for new inbound WhatsApp activity when
                    conversations are open or pending.
                  </p>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        id="notifyOpen"
                        type="checkbox"
                        checked={notifyOpen}
                        onChange={(e) => setNotifyOpen(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="notifyOpen" className="text-sm text-gray-700">
                        Notify for open conversations
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        id="notifyPending"
                        type="checkbox"
                        checked={notifyPending}
                        onChange={(e) => setNotifyPending(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="notifyPending" className="text-sm text-gray-700">
                        Notify for pending conversations
                      </label>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="mt-6 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save notifications"}
                  </button>
                </motion.form>
              )}

              {section === "csat" && (
                <motion.form
                  onSubmit={(e) => void handleSaveCsat(e)}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <Star className="h-5 w-5" />
                    {t("settings.sectionCsat")}
                  </h2>
                  <p className="mb-6 text-sm text-gray-500">{t("settings.csatIntro")}</p>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        id="csatEnabled"
                        type="checkbox"
                        checked={csatEnabled}
                        onChange={(e) => setCsatEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="csatEnabled" className="text-sm text-gray-700">
                        {t("settings.csatEnable")}
                      </label>
                    </div>
                    <div>
                      <label htmlFor="csatSurveyMessage" className="block text-sm font-medium text-gray-700">
                        {t("settings.csatMessageLabel")}
                      </label>
                      <textarea
                        id="csatSurveyMessage"
                        value={csatSurveyMessage}
                        onChange={(e) => setCsatSurveyMessage(e.target.value)}
                        rows={3}
                        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">{t("settings.csatMessageHint")}</p>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="mt-6 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {saving ? t("common.loading") : t("settings.csatSave")}
                  </button>
                </motion.form>
              )}

              {section === "workflow" && (
                <motion.form
                  onSubmit={(e) => void handleSaveWorkflow(e)}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <GitBranch className="h-5 w-5" />
                    {t("settings.workflowTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-gray-500">{t("settings.workflowIntro")}</p>

                  <div className="flex flex-col gap-4 border-b border-gray-100 pb-6">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{t("settings.workflowAutoResolve")}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{t("settings.workflowAutoResolveHint")}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={wfAutoEnabled}
                        onClick={() => setWfAutoEnabled((v) => !v)}
                        className={clsx(
                          "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2",
                          wfAutoEnabled ? "bg-brand-500" : "bg-gray-200",
                        )}
                      >
                        <span
                          className={clsx(
                            "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
                            wfAutoEnabled ? "translate-x-5" : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>

                    <div className={clsx("space-y-4", !wfAutoEnabled && "pointer-events-none opacity-50")}>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[100px]">
                          <label className="block text-sm font-medium text-gray-700">
                            {t("settings.workflowInactivityValue")}
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={wfInactivityValue}
                            onChange={(e) => setWfInactivityValue(Number(e.target.value))}
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <div className="min-w-[140px]">
                          <label className="block text-sm font-medium text-gray-700">
                            {t("settings.workflowInactivityUnit")}
                          </label>
                          <select
                            value={wfInactivityUnit}
                            onChange={(e) =>
                              setWfInactivityUnit(e.target.value as "minutes" | "hours" | "days")
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          >
                            <option value="minutes">{t("settings.workflowUnitMinutes")}</option>
                            <option value="hours">{t("settings.workflowUnitHours")}</option>
                            <option value="days">{t("settings.workflowUnitDays")}</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">{t("settings.workflowInactivityHint")}</p>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.workflowCustomerMessage")}
                        </label>
                        <textarea
                          value={wfCustomerMessage}
                          onChange={(e) => setWfCustomerMessage(e.target.value)}
                          rows={4}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          placeholder={t("settings.workflowCustomerMessagePlaceholder")}
                        />
                        <p className="mt-1 text-xs text-gray-500">{t("settings.workflowCustomerMessageHint")}</p>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{t("settings.workflowSkipAssigned")}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{t("settings.workflowSkipAssignedHint")}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={wfSkipWhenAssigned}
                          onClick={() => setWfSkipWhenAssigned((v) => !v)}
                          className={clsx(
                            "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2",
                            wfSkipWhenAssigned ? "bg-brand-500" : "bg-gray-200",
                          )}
                        >
                          <span
                            className={clsx(
                              "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
                              wfSkipWhenAssigned ? "translate-x-5" : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.workflowAutoLeadType")}
                        </label>
                        <select
                          value={wfAutoLeadTypeId}
                          onChange={(e) => setWfAutoLeadTypeId(e.target.value)}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">{t("settings.workflowSelectLeadType")}</option>
                          {leadTypes.map((lt) => (
                            <option key={lt.id} value={lt.id}>
                              {lt.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t("settings.workflowAutoLeadTypeHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {t("settings.workflowTagAfterResolve")}
                        </label>
                        <select
                          value={wfTagId}
                          onChange={(e) => setWfTagId(e.target.value)}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">{t("settings.workflowSelectTag")}</option>
                          {workflowTags.map((tg) => (
                            <option key={tg.id} value={tg.id}>
                              {tg.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4 border-b border-gray-100 pb-6">
                    <h3 className="text-sm font-semibold text-gray-900">{t("settings.workflowManualTitle")}</h3>
                    <p className="text-xs text-gray-500">{t("settings.workflowManualIntro")}</p>
                    <div className="flex items-center gap-3">
                      <input
                        id="wfReqClosure"
                        type="checkbox"
                        checked={wfRequireClosure}
                        onChange={(e) => setWfRequireClosure(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="wfReqClosure" className="text-sm text-gray-700">
                        {t("settings.workflowRequireClosure")}
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        id="wfReqLead"
                        type="checkbox"
                        checked={wfRequireLeadType}
                        onChange={(e) => setWfRequireLeadType(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="wfReqLead" className="text-sm text-gray-700">
                        {t("settings.workflowRequireLeadType")}
                      </label>
                    </div>
                  </div>

                  {workflowError ? (
                    <p className="mt-4 text-sm text-red-600" role="alert">
                      {workflowError}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={saving}
                    className="mt-6 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {saving ? t("common.loading") : t("settings.workflowSave")}
                  </button>
                </motion.form>
              )}

              {section === "assistant" && (
                <motion.form
                  onSubmit={(e) => void handleSaveAssistant(e)}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <Sparkles className="h-5 w-5" />
                    {t("settings.assistantTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-gray-500">{t("settings.assistantIntro")}</p>
                  {assistantKeyMasked ? (
                    <p className="mb-4 rounded-lg border border-brand-100 bg-brand-50/50 px-3 py-2 text-sm text-brand-900">
                      {t("settings.assistantKeyActiveHint")}
                    </p>
                  ) : null}
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="assistantOpenaiKey" className="block text-sm font-medium text-gray-700">
                        {t("settings.assistantApiKeyLabel")}
                      </label>
                      <input
                        id="assistantOpenaiKey"
                        type="password"
                        autoComplete="off"
                        value={assistantOpenaiKey}
                        onChange={(e) => setAssistantOpenaiKey(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder={assistantKeyMasked ? "••••••••" : ""}
                      />
                      <p className="mt-1 text-xs text-gray-500">{t("settings.assistantApiKeyHint")}</p>
                    </div>
                    <div>
                      <label htmlFor="assistantOpenaiBaseUrl" className="block text-sm font-medium text-gray-700">
                        {t("settings.assistantApiBaseUrlLabel")}
                      </label>
                      <input
                        id="assistantOpenaiBaseUrl"
                        type="url"
                        value={assistantOpenaiBaseUrl}
                        onChange={(e) => setAssistantOpenaiBaseUrl(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="https://api.openai.com/v1"
                      />
                      <p className="mt-1 text-xs text-gray-500">{t("settings.assistantApiBaseUrlHint")}</p>
                    </div>
                  </div>
                  {assistantSaveError ? (
                    <p className="mt-4 text-sm text-red-600" role="alert">
                      {assistantSaveError}
                    </p>
                  ) : null}
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {saving ? t("common.loading") : t("settings.assistantSave")}
                    </button>
                    {assistantKeyMasked ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleRemoveOrgAssistantKey()}
                        className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("settings.assistantRemoveKey")}
                      </button>
                    ) : null}
                  </div>
                </motion.form>
              )}

              {section === "crm" && (
                <motion.div
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <Tag className="h-5 w-5" />
                    {t("settings.leadTypesTitle")}
                  </h2>
                  <p className="mb-4 text-sm text-gray-500">{t("settings.leadTypesHint")}</p>
                  {pipelineOrphans.length > 0 ? (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-900/50 dark:bg-amber-950/25">
                      <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-200">
                        {t("settings.pipelineOrphanTitle")}
                      </h3>
                      <p className="mt-1 text-xs text-amber-900/85 dark:text-amber-300/90">
                        {t("settings.pipelineOrphanHint")}
                      </p>
                      <ul className="mt-3 space-y-2">
                        {pipelineOrphans.map((s) => (
                          <li
                            key={s.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-100 bg-white/90 px-3 py-2 dark:border-amber-900/35 dark:bg-ink-900/50"
                          >
                            <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-ink-100">
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: s.color }}
                              />
                              {s.name}
                            </span>
                            <button
                              type="button"
                              disabled={orphanBusyId === s.id}
                              onClick={() => void handleCreateLeadFromOrphanStage(s)}
                              className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500"
                            >
                              {orphanBusyId === s.id
                                ? t("settings.pipelineOrphanBusy")
                                : t("settings.pipelineOrphanCreate")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {leadTypes.length > 0 && (
                    <ul className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                      {leadTypes.map((lt) => (
                        <li key={lt.id} className="px-3 py-3 text-sm">
                          {editingLtId === lt.id ? (
                            <form
                              onSubmit={(e) => void handleSaveEditLeadType(e, lt.id)}
                              className="space-y-3"
                            >
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="min-w-[140px] flex-1">
                                  <label className="block text-xs font-medium text-gray-600">
                                    {t("settings.leadTypeName")}
                                  </label>
                                  <input
                                    value={editLtName}
                                    onChange={(e) => setEditLtName(e.target.value)}
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-600">
                                    {t("settings.leadTypeColor")}
                                  </label>
                                  <input
                                    type="color"
                                    value={editLtColor}
                                    onChange={(e) => setEditLtColor(e.target.value)}
                                    className="mt-1 h-9 w-14 cursor-pointer rounded border border-gray-200"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600">
                                  {t("settings.leadTypeValueRollup")}
                                </label>
                                <select
                                  value={editLtRollup}
                                  onChange={(e) =>
                                    setEditLtRollup(e.target.value as LeadTypeRow["valueRollup"])
                                  }
                                  className="mt-1 w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                >
                                  <option value="PIPELINE">{t("settings.leadTypeRollupPipeline")}</option>
                                  <option value="WON">{t("settings.leadTypeRollupWon")}</option>
                                  <option value="LOST">{t("settings.leadTypeRollupLost")}</option>
                                  <option value="NONE">{t("settings.leadTypeRollupNone")}</option>
                                </select>
                                <p className="mt-1 text-xs text-gray-500">{t("settings.leadTypeRollupWonHint")}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="submit"
                                  disabled={editLtSubmitting || !editLtName.trim()}
                                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                                >
                                  {t("settings.leadTypeSave")}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditLeadType}
                                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  {t("settings.leadTypeCancelEdit")}
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="flex items-center gap-2 font-medium text-gray-900">
                                  <span
                                    className="h-3 w-3 shrink-0 rounded-full"
                                    style={{ backgroundColor: lt.color }}
                                  />
                                  {lt.name}
                                </span>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  {t(LEAD_ROLLUP_LABEL_KEY[lt.valueRollup ?? "PIPELINE"])}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditLeadType(lt)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  <Pencil className="h-3 w-3" />
                                  {t("settings.leadTypeEdit")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteLeadType(lt.id)}
                                  className="text-xs font-medium text-red-600 hover:text-red-700"
                                >
                                  {t("common.delete")}
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {leadTypes.length === 0 && (
                    <p className="mb-4 text-sm text-gray-500">{t("settings.noLeadTypes")}</p>
                  )}
                  <form onSubmit={handleAddLeadType} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[160px] flex-1">
                      <label className="block text-xs font-medium text-gray-600">
                        {t("settings.leadTypeName")}
                      </label>
                      <input
                        value={newLtName}
                        onChange={(e) => setNewLtName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">
                        {t("settings.leadTypeColor")}
                      </label>
                      <input
                        type="color"
                        value={newLtColor}
                        onChange={(e) => setNewLtColor(e.target.value)}
                        className="mt-1 h-9 w-14 cursor-pointer rounded border border-gray-200"
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="block text-xs font-medium text-gray-600">
                        {t("settings.leadTypeValueRollup")}
                      </label>
                      <select
                        value={newLtRollup}
                        onChange={(e) =>
                          setNewLtRollup(e.target.value as LeadTypeRow["valueRollup"])
                        }
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="PIPELINE">{t("settings.leadTypeRollupPipeline")}</option>
                        <option value="WON">{t("settings.leadTypeRollupWon")}</option>
                        <option value="LOST">{t("settings.leadTypeRollupLost")}</option>
                        <option value="NONE">{t("settings.leadTypeRollupNone")}</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={ltSubmitting || !newLtName.trim()}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {t("settings.addLeadType")}
                    </button>
                  </form>
                  {ltError && <p className="mt-2 text-sm text-red-600">{ltError}</p>}
                  <p className="mt-3 text-xs text-gray-400">{t("settings.saveLeadTypesNote")}</p>
                </motion.div>
              )}

              {section === "templates" && (
                <motion.div
                  className="space-y-6"
                  variants={staggerItem}
                >
                  <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                      <FileText className="h-5 w-5" />
                      {t("settings.templatesTitle")}
                    </h2>
                    <p className="text-sm text-gray-600">{t("settings.templatesMetaHint")}</p>
                  </div>

                  {provider === "evolution" ? (
                    <motion.form
                      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                      variants={staggerItem}
                      onSubmit={(e) => void submitEvolutionTemplate(e)}
                    >
                      <h3 className="mb-1 font-semibold text-gray-900">{t("settings.templatesEvolutionTitle")}</h3>
                      <p className="mb-4 text-sm text-gray-500">{t("settings.templatesEvolutionHint")}</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600">{t("settings.evoTplName")}</label>
                          <input
                            value={evoTplName}
                            onChange={(e) => setEvoTplName(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            required
                            maxLength={512}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">
                            {t("settings.evoTplCategory")}
                          </label>
                          <select
                            value={evoTplCategory}
                            onChange={(e) =>
                              setEvoTplCategory(e.target.value as typeof evoTplCategory)
                            }
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          >
                            <option value="UTILITY">UTILITY</option>
                            <option value="MARKETING">MARKETING</option>
                            <option value="AUTHENTICATION">AUTHENTICATION</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">
                            {t("settings.evoTplLanguage")}
                          </label>
                          <input
                            value={evoTplLanguage}
                            onChange={(e) => setEvoTplLanguage(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            placeholder="pt_BR"
                            required
                            maxLength={32}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600">{t("settings.evoTplBody")}</label>
                          <textarea
                            value={evoTplBody}
                            onChange={(e) => setEvoTplBody(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            rows={5}
                            required
                            maxLength={4096}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600">
                            {t("settings.evoTplFooter")}
                          </label>
                          <input
                            value={evoTplFooter}
                            onChange={(e) => setEvoTplFooter(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            maxLength={160}
                          />
                        </div>
                      </div>
                      {evoTplError ? <p className="mt-3 text-sm text-red-600">{evoTplError}</p> : null}
                      {evoTplSuccess ? (
                        <p className="mt-3 text-sm text-green-700">{t("settings.evoTplSuccess")}</p>
                      ) : null}
                      <button
                        type="submit"
                        disabled={evoTplBusy || !evoTplName.trim() || !evoTplBody.trim()}
                        className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {evoTplBusy ? t("common.loading") : t("settings.evoTplSubmit")}
                      </button>
                    </motion.form>
                  ) : (
                    <motion.div
                      className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-950"
                      variants={staggerItem}
                    >
                      {t("settings.templatesEvolutionOnly")}
                    </motion.div>
                  )}
                </motion.div>
              )}

              {section === "team" && (
                <motion.div
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
                    <UserPlus className="h-5 w-5" />
                    Team & users
                  </h2>
                  <p className="mb-4 text-sm text-gray-500">
                    Create accounts for agents or additional admins. Passwords must be at least 8 characters.
                  </p>

                  {teamUsers.length > 0 && (
                    <div className="mb-6 overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                            <th className="px-4 py-2">Name</th>
                            <th className="px-4 py-2">Email</th>
                            <th className="px-4 py-2">Role</th>
                            <th className="px-4 py-2">Added</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {teamUsers.map((u) => (
                            <tr key={u.id} className="bg-white">
                              <td className="px-4 py-2.5 font-medium text-gray-900">{u.name}</td>
                              <td className="px-4 py-2.5 text-gray-600">{u.email}</td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={
                                    u.role === "ADMIN"
                                      ? "rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                                  }
                                >
                                  {u.role === "ADMIN" ? "Admin" : "Agent"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-500">
                                {new Date(u.createdAt).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <form onSubmit={handleAddUser} className="space-y-4">
                    {userFormError && (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{userFormError}</p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Name</label>
                        <input
                          type="text"
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          required
                          autoComplete="name"
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Email</label>
                        <input
                          type="email"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          required
                          autoComplete="email"
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Role</label>
                        <select
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value as "ADMIN" | "AGENT")}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="AGENT">Agent</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Initial password</label>
                        <input
                          type="password"
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          required
                          minLength={8}
                          autoComplete="new-password"
                          placeholder="At least 8 characters"
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={userFormSubmitting}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {userFormSubmitting ? "Adding…" : "Add user"}
                    </button>
                  </form>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
