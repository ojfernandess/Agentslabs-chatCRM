import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
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
  Pencil,
  Star,
  FileText,
  GitBranch,
  Sparkles,
  Clock,
  MessageSquare,
  Search,
  Palette,
  CheckCheck,
  Phone,
} from "lucide-react";
import { WavoipIntegrationSettings } from "@/pages/settings/WavoipIntegrationSettings";
import { ThreeCxIntegrationSettings } from "@/pages/settings/ThreeCxIntegrationSettings";
import { NvoipIntegrationSettings } from "@/pages/settings/NvoipIntegrationSettings";
import { NvoipAgent2faPanel } from "@/components/nvoip/NvoipAgent2faPanel";
import { EvolutionGoSettingsPanel } from "@/components/settings/EvolutionGoSettingsPanel";
import { WhatsAppMessageTemplatesSection } from "@/components/settings/WhatsAppMessageTemplatesSection";
import { WhatsAppProvidersOverview } from "@/components/settings/WhatsAppProvidersOverview";
import { collectWhatsappProviderOverview } from "@/lib/whatsappProvidersOverview";
import { SlaPoliciesSettings } from "@/components/settings/SlaPoliciesSettings";
import { CannedResponsesSettings } from "@/components/settings/CannedResponsesSettings";
import { OrganizationTagsPanel } from "@/components/settings/OrganizationTagsPanel";
import { TeamSettingsPanel } from "@/components/settings/TeamSettingsPanel";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { WhatsAppProviderConfigFields } from "@/components/inboxes/WhatsAppProviderConfigFields";
import { WhatsAppMetaWebhookCopyPanel } from "@/components/inboxes/WhatsAppMetaWebhookCopyPanel";
import {
  buildInboxWhatsappChannelConfig,
  isInboxWhatsappConfigured,
  isWhatsAppCloudApiProvider,
  parseInboxWhatsappFromChannelConfig,
} from "@/lib/inboxWhatsappConfig";
import {
  settingsCard,
  settingsInput,
  settingsLabel,
  settingsMuted,
  settingsNavActive,
  settingsNavIdle,
  settingsSubtitle,
  settingsTableHead,
  settingsTableRow,
  settingsTableWrap,
  settingsTitle,
} from "@/components/settings/settingsUi";
import { MASKED_WHATSAPP_SECRET } from "@/lib/whatsappOrgConfig";
import {
  createEmbeddedSignupMessageHandler,
  initWhatsAppEmbeddedSignup,
  isValidEmbeddedBusinessData,
  setupFacebookSdk,
} from "@/lib/whatsappEmbeddedSdk";
import clsx from "clsx";
import {
  applyConversationBubbleTheme,
  DEFAULT_BUBBLE_THEME,
  hasCustomBubbleTheme,
} from "@/lib/conversationBubbleTheme";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { notifyOrganizationBrandingUpdated } from "@/hooks/useOrganizationBranding";

type SettingsSection =
  | "channel"
  | "appearance"
  | "notifications"
  | "csat"
  | "sla"
  | "canned"
  | "workflow"
  | "assistant"
  | "leadFinder"
  | "crm"
  | "templates"
  | "tags"
  | "team"
  | "wavoip"
  | "threecx"
  | "nvoip";

type CsatRatingType = "number" | "star" | "emoji";

interface AppSettings {
  whatsappProvider: string | null;
  whatsappApiKey: string | null;
  whatsappPhoneNumberId: string | null;
  evolutionApiBaseUrl: string | null;
  whatsappWebhookSecret: string | null;
  whatsappWebhookVerifyToken?: string | null;
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
  csatRatingType?: CsatRatingType;
  evolutionPlatformQrMode?: boolean;
  evolutionGoPlatformMode?: boolean;
  autoResolveConversationsEnabled?: boolean;
  autoResolveInactivityMinutes?: number;
  autoResolveCustomerMessage?: string | null;
  autoResolveSkipWhenAssigned?: boolean;
  autoResolveTagId?: string | null;
  autoResolveLeadTypeId?: string | null;
  resolveRequireClosureReason?: boolean;
  resolveRequireLeadType?: boolean;
  resolveOfferReminder?: boolean;
  conversationsAttendanceTabEnabled?: boolean;
  conversationsAttendanceTabAutoOpen?: boolean;
  conversationsListShowContactTags?: boolean;
  assistantOpenaiApiKey?: string | null;
  leadFinderSerpApiKey?: string | null;
  assistantOpenaiApiBaseUrl?: string | null;
  conversationBubbleClientColor?: string | null;
  conversationBubbleAgentColor?: string | null;
  conversationBubbleClientColorDark?: string | null;
  conversationBubbleAgentColorDark?: string | null;
  conversationBubbleClientTextColor?: string | null;
  conversationBubbleAgentTextColor?: string | null;
  conversationBubbleClientTextColorDark?: string | null;
  conversationBubbleAgentTextColorDark?: string | null;
  conversationBubbleAgentNameColor?: string | null;
  conversationBubbleAgentNameColorDark?: string | null;
  conversationBubbleClientMetaColor?: string | null;
  conversationBubbleClientMetaColorDark?: string | null;
  conversationBubbleAgentMetaColor?: string | null;
  conversationBubbleAgentMetaColorDark?: string | null;
  organizationLogoUrl?: string | null;
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
  const [searchParams] = useSearchParams();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const showLeadFinder = user?.organizationFeatures?.lead_finder ?? false;
  const showWavoip = (user?.organizationFeatures?.wavoip_voice ?? false) && isAdmin;
  const showThreeCx = (user?.organizationFeatures?.threecx_voice ?? false) && isAdmin;
  const showNvoip =
    (Boolean(user?.organizationFeatures?.nvoip_voice) ||
      Boolean(user?.organizationFeatures?.nvoip_sms) ||
      Boolean(user?.organizationFeatures?.nvoip_otp) ||
      Boolean(user?.organizationFeatures?.nvoip_whatsapp)) &&
    isAdmin;
  const initialSection = searchParams.get("section");
  const [section, setSection] = useState<SettingsSection>(() => {
    if (initialSection === "leadFinder" && showLeadFinder) return "leadFinder";
    if (initialSection === "wavoip" && showWavoip) return "wavoip";
    if (initialSection === "threecx" && showThreeCx) return "threecx";
    if (initialSection === "nvoip" && showNvoip) return "nvoip";
    return "channel";
  });
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
  const [waDisplayPhone, setWaDisplayPhone] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [defaultWaInbox, setDefaultWaInbox] = useState<{
    id: string;
    whatsappWebhookUrl?: string;
    whatsappWebhookVerifyToken?: string | null;
    channelConfig?: unknown;
  } | null>(null);
  const [waInboxes, setWaInboxes] = useState<
    {
      id: string;
      name?: string;
      isDefault?: boolean;
      channelConfig?: unknown;
      whatsappWebhookUrl?: string;
    }[]
  >([]);
  const [autoOptIn, setAutoOptIn] = useState(false);
  const [lockSingleConversation, setLockSingleConversation] = useState(false);
  const [audioTranscriptionEnabled, setAudioTranscriptionEnabled] = useState(false);
  const [silentTransferToAgentBot, setSilentTransferToAgentBot] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(true);
  const [notifyPending, setNotifyPending] = useState(true);
  const [csatEnabled, setCsatEnabled] = useState(false);
  const [csatSurveyMessage, setCsatSurveyMessage] = useState("");
  const [csatRatingType, setCsatRatingType] = useState<CsatRatingType>("number");

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
  const [wfOfferReminder, setWfOfferReminder] = useState(true);
  const [wfAttendanceTabEnabled, setWfAttendanceTabEnabled] = useState(false);
  const [wfAttendanceTabAutoOpen, setWfAttendanceTabAutoOpen] = useState(true);
  const [wfListShowContactTags, setWfListShowContactTags] = useState(false);
  const [workflowError, setWorkflowError] = useState("");

  const [assistantOpenaiKey, setAssistantOpenaiKey] = useState("");
  const [assistantOpenaiBaseUrl, setAssistantOpenaiBaseUrl] = useState("");
  const [leadFinderSerpApiKey, setLeadFinderSerpApiKey] = useState("");
  const [leadFinderSaveError, setLeadFinderSaveError] = useState("");
  const [assistantSaveError, setAssistantSaveError] = useState("");

  const [bubbleClientColor, setBubbleClientColor] = useState<string>(DEFAULT_BUBBLE_THEME.client);
  const [bubbleAgentColor, setBubbleAgentColor] = useState<string>(DEFAULT_BUBBLE_THEME.agent);
  const [bubbleClientDark, setBubbleClientDark] = useState<string>(DEFAULT_BUBBLE_THEME.clientDark);
  const [bubbleAgentDark, setBubbleAgentDark] = useState<string>(DEFAULT_BUBBLE_THEME.agentDark);
  const [bubbleClientTextColor, setBubbleClientTextColor] = useState<string>(DEFAULT_BUBBLE_THEME.clientText);
  const [bubbleAgentTextColor, setBubbleAgentTextColor] = useState<string>(DEFAULT_BUBBLE_THEME.agentText);
  const [bubbleClientTextDark, setBubbleClientTextDark] = useState<string>(DEFAULT_BUBBLE_THEME.clientTextDark);
  const [bubbleAgentTextDark, setBubbleAgentTextDark] = useState<string>(DEFAULT_BUBBLE_THEME.agentTextDark);
  const [bubbleAgentNameColor, setBubbleAgentNameColor] = useState<string>(DEFAULT_BUBBLE_THEME.agentName);
  const [bubbleAgentNameDark, setBubbleAgentNameDark] = useState<string>(DEFAULT_BUBBLE_THEME.agentNameDark);
  const [bubbleClientMetaColor, setBubbleClientMetaColor] = useState<string>(DEFAULT_BUBBLE_THEME.clientMeta);
  const [bubbleClientMetaDark, setBubbleClientMetaDark] = useState<string>(DEFAULT_BUBBLE_THEME.clientMetaDark);
  const [bubbleAgentMetaColor, setBubbleAgentMetaColor] = useState<string>(DEFAULT_BUBBLE_THEME.agentMeta);
  const [bubbleAgentMetaDark, setBubbleAgentMetaDark] = useState<string>(DEFAULT_BUBBLE_THEME.agentMetaDark);
  const [appearanceSaveError, setAppearanceSaveError] = useState("");
  const [appearanceUsesDefaults, setAppearanceUsesDefaults] = useState(true);
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState<string | null>(null);
  const [organizationLogoUrlInput, setOrganizationLogoUrlInput] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const [embeddedInfo, setEmbeddedInfo] = useState<WhatsappEmbeddedTenantInfo | null>(null);
  const [embeddedBusy, setEmbeddedBusy] = useState(false);
  const [embeddedError, setEmbeddedError] = useState("");
  const [embeddedSuccess, setEmbeddedSuccess] = useState(false);
  const authCodeRef = useRef<string | null>(null);

  const [evolutionPlatformQrMode, setEvolutionPlatformQrMode] = useState(false);
  const [evolutionGoPlatformMode, setEvolutionGoPlatformMode] = useState(false);
  const [evoQrBusy, setEvoQrBusy] = useState(false);
  const [evoQrError, setEvoQrError] = useState("");
  const [evoQrNewInstanceName, setEvoQrNewInstanceName] = useState("");
  const [evoQrWebhookWarn, setEvoQrWebhookWarn] = useState(false);
  const [evoQrDataUrl, setEvoQrDataUrl] = useState<string | null>(null);
  const [evoPairingCode, setEvoPairingCode] = useState<string | null>(null);
  const [evoConnPoll, setEvoConnPoll] = useState<{ connected: boolean; state: string } | null>(null);
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
      setEvolutionGoPlatformMode(data.evolutionGoPlatformMode ?? false);
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

  const ensureEvolutionGoProviderSaved = async (): Promise<boolean> => {
    if (settings?.whatsappProvider === "evolution_go") return true;
    if (provider !== "evolution_go") return false;
    try {
      const body: Record<string, unknown> = { whatsappProvider: "evolution_go" };
      if (!evolutionGoPlatformMode) {
        if (evolutionBaseUrl.trim()) body.evolutionApiBaseUrl = evolutionBaseUrl.trim();
        if (apiKey.trim()) body.whatsappApiKey = apiKey.trim();
      } else {
        body.evolutionApiBaseUrl = null;
      }
      const data = await api.put<AppSettings>("/settings", body);
      setSettings(data);
      setProvider("evolution_go");
      setEvolutionGoPlatformMode(data.evolutionGoPlatformMode ?? false);
      return data.whatsappProvider === "evolution_go";
    } catch {
      return false;
    }
  };

  const persistEvolutionGoInstanceId = async (instanceId: string) => {
    setPhoneNumberId(instanceId);
    setProvider("evolution_go");
    try {
      const data = await api.put<AppSettings>("/settings", {
        whatsappProvider: "evolution_go",
        whatsappPhoneNumberId: instanceId,
      });
      setSettings(data);
    } catch {
      /* user can save manually */
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
        const [data, lt, tags, botList, emb, inboxesRes] = await Promise.all([
          api.get<AppSettings>("/settings"),
          api.get<LeadTypeRow[]>("/lead-types"),
          api.get<TagListRow[]>("/tags").catch(() => [] as TagListRow[]),
          api.get<{ data: AgentBotOption[] }>("/bots").catch(() => ({ data: [] as AgentBotOption[] })),
          api.get<WhatsappEmbeddedTenantInfo>("/settings/whatsapp-embedded").catch(() => null),
          api
            .get<{
              data: {
                id: string;
                channelType: string;
                isDefault: boolean;
                channelConfig?: unknown;
                whatsappWebhookUrl?: string;
                whatsappWebhookVerifyToken?: string | null;
              }[];
            }>("/inboxes")
            .catch(() => ({ data: [] })),
        ]);
        setEmbeddedInfo(emb ?? null);
        setSettings(data);
        setWaInboxes(
          inboxesRes.data
            .filter((i) => i.channelType === "WHATSAPP")
            .map((i) => ({
              id: i.id,
              name: (i as { name?: string }).name,
              isDefault: i.isDefault,
              channelConfig: i.channelConfig,
              whatsappWebhookUrl: i.whatsappWebhookUrl,
            })),
        );
        const waInbox =
          inboxesRes.data.find((i) => i.isDefault && i.channelType === "WHATSAPP") ??
          inboxesRes.data.find((i) => i.channelType === "WHATSAPP") ??
          null;
        const waFromInbox = waInbox ? parseInboxWhatsappFromChannelConfig(waInbox.channelConfig) : {};
        setDefaultWaInbox(
          waInbox
            ? {
                id: waInbox.id,
                whatsappWebhookUrl: waInbox.whatsappWebhookUrl,
                whatsappWebhookVerifyToken: waInbox.whatsappWebhookVerifyToken,
                channelConfig: waInbox.channelConfig,
              }
            : null,
        );
        setProvider(waFromInbox.whatsappProvider ?? data.whatsappProvider ?? "");
        setPhoneNumberId(waFromInbox.whatsappPhoneNumberId ?? data.whatsappPhoneNumberId ?? "");
        setWaDisplayPhone(waFromInbox.whatsappDisplayPhone ?? "");
        setWaWabaId(waFromInbox.whatsappBusinessAccountId ?? "");
        setEvolutionPlatformQrMode(data.evolutionPlatformQrMode ?? false);
        setEvolutionGoPlatformMode(data.evolutionGoPlatformMode ?? false);
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
        setCsatRatingType(data.csatRatingType === "star" || data.csatRatingType === "emoji" ? data.csatRatingType : "number");
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
        setWfOfferReminder(data.resolveOfferReminder ?? true);
        setWfAttendanceTabEnabled(data.conversationsAttendanceTabEnabled ?? false);
        setWfAttendanceTabAutoOpen(data.conversationsAttendanceTabAutoOpen !== false);
        setWfListShowContactTags(data.conversationsListShowContactTags ?? false);
        setWorkflowError("");
        setAssistantOpenaiKey("");
        setAssistantOpenaiBaseUrl(data.assistantOpenaiApiBaseUrl ?? "");
        setLeadFinderSerpApiKey("");
        setLeadFinderSaveError("");
        setAssistantSaveError("");
        setAppearanceSaveError("");
        setAppearanceUsesDefaults(!hasCustomBubbleTheme(data));
        setBubbleClientColor(data.conversationBubbleClientColor ?? DEFAULT_BUBBLE_THEME.client);
        setBubbleAgentColor(data.conversationBubbleAgentColor ?? DEFAULT_BUBBLE_THEME.agent);
        setBubbleClientDark(data.conversationBubbleClientColorDark ?? DEFAULT_BUBBLE_THEME.clientDark);
        setBubbleAgentDark(data.conversationBubbleAgentColorDark ?? DEFAULT_BUBBLE_THEME.agentDark);
        setBubbleClientTextColor(data.conversationBubbleClientTextColor ?? DEFAULT_BUBBLE_THEME.clientText);
        setBubbleAgentTextColor(data.conversationBubbleAgentTextColor ?? DEFAULT_BUBBLE_THEME.agentText);
        setBubbleClientTextDark(data.conversationBubbleClientTextColorDark ?? DEFAULT_BUBBLE_THEME.clientTextDark);
        setBubbleAgentTextDark(data.conversationBubbleAgentTextColorDark ?? DEFAULT_BUBBLE_THEME.agentTextDark);
        setBubbleAgentNameColor(data.conversationBubbleAgentNameColor ?? DEFAULT_BUBBLE_THEME.agentName);
        setBubbleAgentNameDark(data.conversationBubbleAgentNameColorDark ?? DEFAULT_BUBBLE_THEME.agentNameDark);
        setBubbleClientMetaColor(data.conversationBubbleClientMetaColor ?? DEFAULT_BUBBLE_THEME.clientMeta);
        setBubbleClientMetaDark(data.conversationBubbleClientMetaColorDark ?? DEFAULT_BUBBLE_THEME.clientMetaDark);
        setBubbleAgentMetaColor(data.conversationBubbleAgentMetaColor ?? DEFAULT_BUBBLE_THEME.agentMeta);
        setBubbleAgentMetaDark(data.conversationBubbleAgentMetaColorDark ?? DEFAULT_BUBBLE_THEME.agentMetaDark);
        setOrganizationLogoUrl(data.organizationLogoUrl ?? null);
        setOrganizationLogoUrlInput(data.organizationLogoUrl ?? "");
        setLogoError("");
        setAgentBotId(data.agentBotId ?? "");
        setAgentBotOptions(botList.data.map((b) => ({ id: b.id, name: b.name })));
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
        resolveOfferReminder: wfOfferReminder,
        conversationsAttendanceTabEnabled: wfAttendanceTabEnabled,
        conversationsAttendanceTabAutoOpen: wfAttendanceTabAutoOpen,
        conversationsListShowContactTags: wfListShowContactTags,
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
      setWfOfferReminder(data.resolveOfferReminder ?? true);
      setWfAttendanceTabEnabled(data.conversationsAttendanceTabEnabled ?? false);
      setWfAttendanceTabAutoOpen(data.conversationsAttendanceTabAutoOpen !== false);
      setWfListShowContactTags(data.conversationsListShowContactTags ?? false);
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
        csatRatingType,
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

  const handleSaveLeadFinder = async (e: FormEvent) => {
    e.preventDefault();
    setLeadFinderSaveError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (leadFinderSerpApiKey.trim()) {
        body.leadFinderSerpApiKey = leadFinderSerpApiKey.trim();
      }
      const data = await api.put<AppSettings>("/settings", body);
      setSettings(data);
      setLeadFinderSerpApiKey("");
    } catch (err) {
      setLeadFinderSaveError(err instanceof Error ? err.message : t("settings.leadFinderSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLeadFinderKey = async () => {
    if (!window.confirm(t("settings.leadFinderRemoveKeyConfirm"))) return;
    setLeadFinderSaveError("");
    setSaving(true);
    try {
      const data = await api.put<AppSettings>("/settings", { leadFinderSerpApiKey: null });
      setSettings(data);
      setLeadFinderSerpApiKey("");
    } catch (err) {
      setLeadFinderSaveError(err instanceof Error ? err.message : t("settings.leadFinderSaveError"));
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

  const handleSaveAppearance = async (e: FormEvent) => {
    e.preventDefault();
    setAppearanceSaveError("");
    setSaving(true);
    try {
      const payload = appearanceUsesDefaults
        ? {
            conversationBubbleClientColor: null,
            conversationBubbleAgentColor: null,
            conversationBubbleClientColorDark: null,
            conversationBubbleAgentColorDark: null,
            conversationBubbleClientTextColor: null,
            conversationBubbleAgentTextColor: null,
            conversationBubbleClientTextColorDark: null,
            conversationBubbleAgentTextColorDark: null,
            conversationBubbleAgentNameColor: null,
            conversationBubbleAgentNameColorDark: null,
            conversationBubbleClientMetaColor: null,
            conversationBubbleClientMetaColorDark: null,
            conversationBubbleAgentMetaColor: null,
            conversationBubbleAgentMetaColorDark: null,
          }
        : {
            conversationBubbleClientColor: bubbleClientColor,
            conversationBubbleAgentColor: bubbleAgentColor,
            conversationBubbleClientColorDark: bubbleClientDark,
            conversationBubbleAgentColorDark: bubbleAgentDark,
            conversationBubbleClientTextColor: bubbleClientTextColor,
            conversationBubbleAgentTextColor: bubbleAgentTextColor,
            conversationBubbleClientTextColorDark: bubbleClientTextDark,
            conversationBubbleAgentTextColorDark: bubbleAgentTextDark,
            conversationBubbleAgentNameColor: bubbleAgentNameColor,
            conversationBubbleAgentNameColorDark: bubbleAgentNameDark,
            conversationBubbleClientMetaColor: bubbleClientMetaColor,
            conversationBubbleClientMetaColorDark: bubbleClientMetaDark,
            conversationBubbleAgentMetaColor: bubbleAgentMetaColor,
            conversationBubbleAgentMetaColorDark: bubbleAgentMetaDark,
          };
      const data = await api.put<AppSettings>("/settings", payload);
      setSettings(data);
      applyConversationBubbleTheme(data);
      setAppearanceUsesDefaults(!hasCustomBubbleTheme(data));
    } catch {
      setAppearanceSaveError(t("settings.appearanceSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleResetAppearance = () => {
    setAppearanceUsesDefaults(true);
    setBubbleClientColor(DEFAULT_BUBBLE_THEME.client);
    setBubbleAgentColor(DEFAULT_BUBBLE_THEME.agent);
    setBubbleClientDark(DEFAULT_BUBBLE_THEME.clientDark);
    setBubbleAgentDark(DEFAULT_BUBBLE_THEME.agentDark);
    setBubbleClientTextColor(DEFAULT_BUBBLE_THEME.clientText);
    setBubbleAgentTextColor(DEFAULT_BUBBLE_THEME.agentText);
    setBubbleClientTextDark(DEFAULT_BUBBLE_THEME.clientTextDark);
    setBubbleAgentTextDark(DEFAULT_BUBBLE_THEME.agentTextDark);
    setBubbleAgentNameColor(DEFAULT_BUBBLE_THEME.agentName);
    setBubbleAgentNameDark(DEFAULT_BUBBLE_THEME.agentNameDark);
    setBubbleClientMetaColor(DEFAULT_BUBBLE_THEME.clientMeta);
    setBubbleClientMetaDark(DEFAULT_BUBBLE_THEME.clientMetaDark);
    setBubbleAgentMetaColor(DEFAULT_BUBBLE_THEME.agentMeta);
    setBubbleAgentMetaDark(DEFAULT_BUBBLE_THEME.agentMetaDark);
  };

  const handleSaveOrganizationLogoUrl = async () => {
    setLogoError("");
    setLogoBusy(true);
    try {
      const trimmed = organizationLogoUrlInput.trim();
      const data = await api.put<AppSettings>("/settings", {
        organizationLogoUrl: trimmed || null,
      });
      setSettings(data);
      setOrganizationLogoUrl(data.organizationLogoUrl ?? null);
      setOrganizationLogoUrlInput(data.organizationLogoUrl ?? "");
      notifyOrganizationBrandingUpdated();
    } catch {
      setLogoError(t("settings.organizationLogoSaveError"));
    } finally {
      setLogoBusy(false);
    }
  };

  const handleClearOrganizationLogo = async () => {
    setLogoError("");
    setLogoBusy(true);
    try {
      const data = await api.put<AppSettings>("/settings", { organizationLogoUrl: null });
      setSettings(data);
      setOrganizationLogoUrl(null);
      setOrganizationLogoUrlInput("");
      notifyOrganizationBrandingUpdated();
    } catch {
      setLogoError(t("settings.organizationLogoSaveError"));
    } finally {
      setLogoBusy(false);
    }
  };

  const handleOrganizationLogoFile = async (file: File | null) => {
    if (!file) return;
    setLogoError("");
    setLogoBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await api.postMultipart<{ organizationLogoUrl: string | null }>(
        "/settings/organization-logo",
        form,
      );
      setOrganizationLogoUrl(data.organizationLogoUrl ?? null);
      setOrganizationLogoUrlInput(data.organizationLogoUrl ?? "");
      setSettings((prev) => (prev ? { ...prev, organizationLogoUrl: data.organizationLogoUrl ?? null } : prev));
      notifyOrganizationBrandingUpdated();
    } catch {
      setLogoError(t("settings.organizationLogoUploadError"));
    } finally {
      setLogoBusy(false);
      if (logoFileInputRef.current) logoFileInputRef.current.value = "";
    }
  };

  const bubblePreviewStyle = (
    bg: string,
    text: string,
    meta?: string,
    agentName?: string,
  ): CSSProperties => ({
    backgroundColor: bg,
    color: text,
    ...(meta ? { ["--crm-bubble-meta" as string]: meta } : {}),
    ...(agentName ? { ["--org-bubble-agent-name" as string]: agentName } : {}),
  });

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
      if (!((provider === "evolution" && evolutionPlatformQrMode) || (provider === "evolution_go" && evolutionGoPlatformMode))) {
        if (apiKey) body.whatsappApiKey = apiKey;
      }
      if (phoneNumberId) body.whatsappPhoneNumberId = phoneNumberId;
      if (webhookSecret) body.whatsappWebhookSecret = webhookSecret;
      if (waDisplayPhone.trim()) body.whatsappDisplayPhone = waDisplayPhone.trim();
      if (waWabaId.trim()) body.whatsappBusinessAccountId = waWabaId.trim();
      if (provider === "evolution" && !evolutionPlatformQrMode) {
        body.evolutionApiBaseUrl = evolutionBaseUrl.trim() || null;
      } else if (provider === "evolution_go") {
        body.evolutionApiBaseUrl = evolutionGoPlatformMode ? null : (evolutionBaseUrl.trim() || null);
      } else if (provider && provider !== "evolution" && provider !== "evolution_go") {
        body.evolutionApiBaseUrl = null;
      }
      body.agentBotId = agentBotId.trim() ? agentBotId.trim() : null;

      const data = await api.put<AppSettings>("/settings", body);
      setSettings(data);
      setEvolutionPlatformQrMode(data.evolutionPlatformQrMode ?? false);
      setEvolutionGoPlatformMode(data.evolutionGoPlatformMode ?? false);
      setApiKey("");
      setWebhookSecret("");
      const inboxesReload = await api
        .get<{
          data: {
            id: string;
            name?: string;
            channelType: string;
            isDefault: boolean;
            channelConfig?: unknown;
            whatsappWebhookUrl?: string;
            whatsappWebhookVerifyToken?: string | null;
          }[];
        }>("/inboxes")
        .catch(() => ({ data: [] }));
      setWaInboxes(
        inboxesReload.data
          .filter((i) => i.channelType === "WHATSAPP")
          .map((i) => ({
            id: i.id,
            name: i.name,
            isDefault: i.isDefault,
            channelConfig: i.channelConfig,
            whatsappWebhookUrl: i.whatsappWebhookUrl,
          })),
      );
      const waInbox =
        inboxesReload.data.find((i) => i.isDefault && i.channelType === "WHATSAPP") ??
        inboxesReload.data.find((i) => i.channelType === "WHATSAPP") ??
        null;
      if (waInbox) {
        const wa = parseInboxWhatsappFromChannelConfig(waInbox.channelConfig);
        setProvider(wa.whatsappProvider ?? data.whatsappProvider ?? "");
        setPhoneNumberId(wa.whatsappPhoneNumberId ?? data.whatsappPhoneNumberId ?? "");
        setWaDisplayPhone(wa.whatsappDisplayPhone ?? "");
        setWaWabaId(wa.whatsappBusinessAccountId ?? "");
        setDefaultWaInbox({
          id: waInbox.id,
          whatsappWebhookUrl: waInbox.whatsappWebhookUrl,
          whatsappWebhookVerifyToken: waInbox.whatsappWebhookVerifyToken,
          channelConfig: waInbox.channelConfig,
        });
      }
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
      if (provider === "meta" || provider === "360dialog") {
        const hasNewApiKey = Boolean(apiKey.trim() && apiKey !== MASKED_WHATSAPP_SECRET);
        const hasNewWebhookSecret = Boolean(
          webhookSecret.trim() && webhookSecret !== MASKED_WHATSAPP_SECRET,
        );
        if (defaultWaInbox?.id && !hasNewApiKey && !hasNewWebhookSecret) {
          const result = await api.post<{ connected: boolean }>(
            `/settings/test-connection?inboxId=${encodeURIComponent(defaultWaInbox.id)}`,
          );
          setTestResult(result.connected);
        } else {
          const channelConfig = buildInboxWhatsappChannelConfig(defaultWaInbox?.channelConfig ?? null, {
            whatsappProvider: provider,
            whatsappPhoneNumberId: phoneNumberId,
            whatsappApiKey: apiKey,
            whatsappWebhookSecret: webhookSecret,
            whatsappDisplayPhone: waDisplayPhone,
            whatsappBusinessAccountId: waWabaId,
          });
          const result = await api.post<{ connected: boolean }>("/settings/test-whatsapp-draft", {
            channelConfig,
            ...(defaultWaInbox?.id ? { inboxId: defaultWaInbox.id } : {}),
          });
          setTestResult(result.connected);
        }
      } else {
        const q = defaultWaInbox?.id ? `?inboxId=${encodeURIComponent(defaultWaInbox.id)}` : "";
        const result = await api.post<{ connected: boolean }>(`/settings/test-connection${q}`);
        setTestResult(result.connected);
      }
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
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

  const waInboxProvider = defaultWaInbox
    ? parseInboxWhatsappFromChannelConfig(defaultWaInbox.channelConfig).whatsappProvider
    : undefined;
  const effectiveWhatsAppProvider =
    provider || waInboxProvider || settings?.whatsappProvider || "";
  const isMetaCloudSettingsProvider = isWhatsAppCloudApiProvider(effectiveWhatsAppProvider);
  const whatsappProviderOverview = collectWhatsappProviderOverview(settings, waInboxes, provider);
  const evolutionGoInboxRow = waInboxes.find(
    (i) => parseInboxWhatsappFromChannelConfig(i.channelConfig).whatsappProvider === "evolution_go",
  );
  const evolutionGoWebhookDisplay =
    evolutionGoInboxRow?.whatsappWebhookUrl ?? settings?.webhookUrl ?? webhookDisplay;

  const regenerateVerifyToken = async () => {
    setSaving(true);
    try {
      const data = await api.put<AppSettings>("/settings", { whatsappRegenerateVerifyToken: true });
      setSettings(data);
    } catch {
      /* failed */
    } finally {
      setSaving(false);
    }
  };

  const assistantKeyMasked = settings?.assistantOpenaiApiKey === "••••••••";
  const leadFinderKeyMasked = settings?.leadFinderSerpApiKey === "••••••••";

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-ink-500 dark:text-ink-400">{t("common.adminRequired")}</p>
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
      <div className="page-shell">
        <div className="page-shell-inner">
          <div className="mb-8 border-b border-ink-200/80 pb-6 dark:border-white/10">
            <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">{t("settings.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-500 dark:text-ink-400">{t("settings.subtitle")}</p>
          </div>

          {user?.organizationFeatures?.nvoip_otp ? <NvoipAgent2faPanel /> : null}

          <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
            <nav
              className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:gap-0.5 lg:overflow-visible"
              aria-label="Settings sections"
            >
              {(
                [
                  ["channel", t("settings.sectionChannel"), Smartphone],
                  ["appearance", t("settings.sectionAppearance"), Palette],
                  ["notifications", t("settings.sectionNotifications"), Bell],
                  ["csat", t("settings.sectionCsat"), Star],
                  ["sla", t("settings.sectionSla"), Clock],
                  ["canned", t("settings.sectionCanned"), MessageSquare],
                  ["workflow", t("settings.sectionWorkflow"), GitBranch],
                  ["assistant", t("settings.sectionAssistant"), Sparkles],
                  ...(showLeadFinder ? ([["leadFinder", t("settings.sectionLeadFinder"), Search]] as const) : []),
                  ["crm", t("settings.sectionCrm"), Tag],
                  ...(showWavoip ? ([["wavoip", t("settings.sectionWavoip"), Phone]] as const) : []),
                  ...(showThreeCx ? ([["threecx", t("settings.sectionThreeCx"), Phone]] as const) : []),
                  ...(showNvoip ? ([["nvoip", t("settings.sectionNvoip"), Phone]] as const) : []),
                  ["templates", t("settings.sectionTemplates"), FileText],
                  ["tags", t("settings.sectionTags"), Tag],
                  ["team", t("settings.sectionTeam"), UserPlus],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  className={clsx(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors",
                    section === id ? settingsNavActive : settingsNavIdle,
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0 text-ink-500 dark:text-ink-400" />
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
                    className="rounded-xl border border-brand-200/80 bg-brand-50/60 p-4 text-sm text-brand-900 dark:border-brand-800/50 dark:bg-brand-950/30 dark:text-brand-100"
                    variants={staggerItem}
                  >
                    <p className="font-medium">{t("settings.channelUnifiedTitle")}</p>
                    <p className="mt-1 text-brand-800/90">{t("settings.channelUnifiedBody")}</p>
                    <a href="/inboxes" className="mt-2 inline-block font-medium text-brand-700 underline">
                      {t("settings.channelUnifiedLink")}
                    </a>
                  </motion.div>
                  {embeddedInfo?.available ? (
                    <motion.div
                      className="card-surface rounded-xl p-6"
                      variants={staggerItem}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100">
                          <WhatsAppBrandIcon className="h-6 w-6" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div>
                            <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("settings.embeddedTitle")}</h2>
                            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("settings.embeddedDesc")}</p>
                          </div>
                          <ul className="space-y-2 text-sm text-ink-700 dark:text-ink-300">
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
                          <p className="text-xs text-ink-500 dark:text-ink-400">
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
                    className="card-surface rounded-xl p-6"
                    variants={staggerItem}
                  >
                    <p className="mb-4 text-sm text-ink-600 dark:text-ink-400">{t("settings.channelHint")}</p>
                    {isMetaCloudSettingsProvider &&
                    (defaultWaInbox?.whatsappWebhookVerifyToken || settings?.whatsappWebhookVerifyToken) ? (
                      <WhatsAppMetaWebhookCopyPanel
                        webhookUrl={defaultWaInbox?.whatsappWebhookUrl ?? webhookDisplay}
                        verifyToken={
                          defaultWaInbox?.whatsappWebhookVerifyToken ??
                          settings?.whatsappWebhookVerifyToken ??
                          ""
                        }
                        onRegenerateVerifyToken={() => void regenerateVerifyToken()}
                        regenerating={saving}
                      />
                    ) : (
                      <>
                        <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                          <Settings className="h-5 w-5" />
                          Webhook URL
                        </h2>
                        <p className="mb-3 text-sm text-ink-500 dark:text-ink-400">{t("settings.webhookCopyHint")}</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-sm text-ink-700 dark:text-ink-300">
                            {webhookDisplay || "—"}
                          </code>
                          <button
                            type="button"
                            onClick={copyWebhookUrl}
                            className="rounded-lg border border-ink-200/80 p-2 text-ink-500 hover:bg-ink-50 dark:border-white/10 dark:text-ink-400 dark:hover:bg-white/5"
                          >
                            {copied ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </motion.div>

                  <motion.form
                    id="whatsapp-manual-setup"
                    onSubmit={handleSave}
                    className="card-surface rounded-xl p-6"
                    variants={staggerItem}
                  >
                    <h2 className="mb-2 font-semibold text-ink-900 dark:text-ink-50">WhatsApp provider</h2>
                    <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">
                      Configure e gira cada integração WhatsApp da organização. O provider principal é o que fica ativo
                      nesta página ao guardar.
                    </p>

                    <div className="space-y-6">
                      <WhatsAppProvidersOverview
                        items={whatsappProviderOverview}
                        activeProvider={provider}
                        onSelectProvider={setProvider}
                      />

                      {!provider ? (
                        <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3 text-sm text-ink-600 dark:border-white/10 dark:bg-black/10 dark:text-ink-400">
                          Selecione um provider acima para ver e editar as credenciais.
                        </p>
                      ) : (
                      <div className="rounded-xl border border-ink-200/80 bg-white/50 p-4 dark:border-white/10 dark:bg-black/5">
                        <p className="mb-4 text-sm font-semibold text-ink-900 dark:text-ink-50">
                          Configuração: {whatsappProviderOverview.find((x) => x.id === provider)?.label ?? provider}
                        </p>
                      <div className="space-y-4">

                      {provider === "evolution" && evolutionPlatformQrMode ? (
                        <div className="space-y-4 rounded-lg border border-brand-200/80 bg-brand-50/60 p-4 dark:border-brand-800/50 dark:bg-brand-950/25">
                          <div>
                            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("settings.evolutionQrTitle")}</h3>
                            <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">{t("settings.evolutionQrSubtitle")}</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
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
                            <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">{t("settings.evolutionQrInstanceNameHint")}</p>
                          </div>
                          {evoConnPoll ? (
                            <p className="text-sm text-ink-800 dark:text-ink-200">
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
                            <p className="text-xs text-ink-600 dark:text-ink-400">
                              <span className="font-medium text-ink-800 dark:text-ink-200">{t("settings.evolutionQrInstance")}:</span>{" "}
                              <code className="rounded bg-white px-1.5 py-0.5">{phoneNumberId}</code>
                            </p>
                          ) : null}
                          {evoPairingCode ? (
                            <p className="text-xs text-ink-600 dark:text-ink-400">
                              <span className="font-medium text-ink-800 dark:text-ink-200">{t("settings.evolutionQrPairing")}:</span>{" "}
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
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink-800 dark:text-ink-200 hover:bg-gray-50 disabled:opacity-50"
                              >
                                {t("settings.evolutionQrRefresh")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {(provider === "evolution" && !evolutionPlatformQrMode) ||
                      (provider === "evolution_go" && !evolutionGoPlatformMode) ? (
                        <div>
                          <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
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
                            className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
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

                      {isMetaCloudSettingsProvider ? (
                        <WhatsAppProviderConfigFields
                          waProvider={provider}
                          onProviderChange={setProvider}
                          waDisplayPhone={waDisplayPhone}
                          onDisplayPhoneChange={setWaDisplayPhone}
                          waProviderPhoneId={phoneNumberId}
                          onPhoneNumberIdChange={setPhoneNumberId}
                          waWabaId={waWabaId}
                          onWabaIdChange={setWaWabaId}
                          waProviderApiKey={apiKey}
                          onApiKeyChange={setApiKey}
                          waWebhookSecret={webhookSecret}
                          onWebhookSecretChange={setWebhookSecret}
                          webhookSecretStored={
                            parseInboxWhatsappFromChannelConfig(defaultWaInbox?.channelConfig).whatsappWebhookSecret ===
                              MASKED_WHATSAPP_SECRET || !!settings?.whatsappWebhookSecret
                          }
                          waProviderBaseUrl=""
                          onBaseUrlChange={() => {}}
                          evolutionPlatformQrMode={evolutionPlatformQrMode}
                          evolutionGoPlatformMode={evolutionGoPlatformMode}
                          apiKeyOptionalHint={
                            parseInboxWhatsappFromChannelConfig(defaultWaInbox?.channelConfig).whatsappApiKey ===
                              MASKED_WHATSAPP_SECRET || !!settings?.whatsappApiKey
                          }
                          metaFieldSet="full"
                          showProviderSelect={false}
                          onTestConnection={() => void handleTestConnection()}
                          testConnectionBusy={testing}
                          testConnectionResult={testResult}
                        />
                      ) : null}

                      {!isMetaCloudSettingsProvider &&
                      !((provider === "evolution" && evolutionPlatformQrMode) || (provider === "evolution_go" && evolutionGoPlatformMode)) && (
                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {provider === "evolution" ? "API key" : "API Key"}
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={settings?.whatsappApiKey ? "••••••••" : "Enter API key"}
                          className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        {provider === "evolution" && !evolutionPlatformQrMode && (
                          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                            Same value as Evolution&apos;s global API key env (often{" "}
                            <code className="rounded bg-gray-100 px-1">AUTHENTICATION_API_KEY</code>); sent as the{" "}
                            <code className="rounded bg-gray-100 px-1">apikey</code> header.
                          </p>
                        )}
                      </div>
                      )}

                      {!isMetaCloudSettingsProvider &&
                      !(provider === "evolution" && evolutionPlatformQrMode) &&
                      !(provider === "evolution_go" && evolutionGoPlatformMode) && (
                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {provider === "evolution"
                            ? "Instance name"
                            : provider === "evolution_go"
                              ? "Instance name or ID"
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
                                ? "Nome ou UUID da instância"
                                : "Enter phone number ID"
                          }
                          className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      )}

                      {provider === "evolution_go" ? (
                        <EvolutionGoSettingsPanel
                          webhookUrl={evolutionGoWebhookDisplay}
                          savedInstanceId={settings?.whatsappPhoneNumberId ?? phoneNumberId}
                          platformMode={evolutionGoPlatformMode}
                          onInstanceIdChange={(id) => void persistEvolutionGoInstanceId(id)}
                          onProviderEnsureSaved={ensureEvolutionGoProviderSaved}
                        />
                      ) : null}

                      {!isMetaCloudSettingsProvider ? (
                        <div>
                          <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">Webhook secret</label>
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
                            className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          {provider === "evolution" ? (
                            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                              <strong>Evolution does not supply this.</strong> Leave it empty for the usual setup —
                              webhooks work without it. For extra verification, invent any long random string, save it
                              here, then in Evolution configure the instance webhook <strong>headers</strong> (e.g. in
                              the webhook JSON or manager UI) with name{" "}
                              <code className="rounded bg-gray-100 px-1">x-openconduit-token</code> and value identical to
                              this field. If this field is filled, requests without that header are rejected with 401.
                            </p>
                          ) : provider === "evolution_go" ? (
                            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                              Opcional. Deixe vazio para aceitar o <code className="rounded bg-gray-100 px-1">instanceToken</code>{" "}
                              enviado pelo Evolution Go (token da instância). Se preencher, o valor deve coincidir com o
                              token da instância ou use o header{" "}
                              <code className="rounded bg-gray-100 px-1">x-openconduit-token</code>.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      </div>
                      </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.agentBotWhatsApp")}
                        </label>
                        <select
                          value={agentBotId}
                          onChange={(e) => setAgentBotId(e.target.value)}
                          className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">{t("settings.agentBotNone")}</option>
                          {agentBotOptions.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.agentBotWhatsAppHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.lockSingleConversation")}
                        </label>
                        <select
                          value={lockSingleConversation ? "on" : "off"}
                          onChange={(e) => setLockSingleConversation(e.target.value === "on")}
                          className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="on">{t("settings.lockSingleConversationOn")}</option>
                          <option value="off">{t("settings.lockSingleConversationOff")}</option>
                        </select>
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.lockSingleConversationHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.audioTranscription")}
                        </label>
                        <select
                          value={audioTranscriptionEnabled ? "on" : "off"}
                          onChange={(e) => setAudioTranscriptionEnabled(e.target.value === "on")}
                          className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="on">{t("settings.audioTranscriptionOn")}</option>
                          <option value="off">{t("settings.audioTranscriptionOff")}</option>
                        </select>
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.audioTranscriptionHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.silentTransferToAgentBot")}
                        </label>
                        <select
                          value={silentTransferToAgentBot ? "on" : "off"}
                          onChange={(e) => setSilentTransferToAgentBot(e.target.value === "on")}
                          className="mt-1 block w-full input-field focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="on">{t("settings.silentTransferToAgentBotOn")}</option>
                          <option value="off">{t("settings.silentTransferToAgentBotOff")}</option>
                        </select>
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.silentTransferToAgentBotHint")}</p>
                      </div>

                      <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
                        <input
                          id="autoOptIn"
                          type="checkbox"
                          checked={autoOptIn}
                          onChange={(e) => setAutoOptIn(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                        />
                        <label htmlFor="autoOptIn" className="text-sm text-ink-700 dark:text-ink-300">
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
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-ink-700 dark:text-ink-300 hover:bg-gray-50 disabled:opacity-50"
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

              {section === "appearance" && (
                <motion.form
                  onSubmit={(e) => void handleSaveAppearance(e)}
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <Palette className="h-5 w-5" />
                    {t("settings.sectionAppearance")}
                  </h2>
                  <p className="mb-6 text-sm text-ink-500 dark:text-ink-400">{t("settings.appearanceIntro")}</p>

                  <div className="mb-8 rounded-xl border border-ink-200/80 bg-ink-50/50 p-4 dark:border-white/10 dark:bg-ink-950/40">
                    <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                      {t("settings.organizationLogoTitle")}
                    </h3>
                    <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("settings.organizationLogoIntro")}</p>

                    <div className="mt-4 flex flex-wrap items-center gap-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-ink-200 bg-white p-2 dark:border-ink-600 dark:bg-ink-900">
                        <img
                          src={organizationLogoUrl || brandAssetUrl("/logo.svg")}
                          alt={t("settings.organizationLogoTitle")}
                          className="max-h-full max-w-full object-contain"
                          decoding="async"
                        />
                      </div>
                      <p className="text-xs text-ink-500 dark:text-ink-400">
                        {organizationLogoUrl
                          ? t("settings.organizationLogoUsingCustom")
                          : t("settings.organizationLogoUsingSystem")}
                      </p>
                    </div>

                    {logoError ? (
                      <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                        {logoError}
                      </p>
                    ) : null}

                    <label className="mt-4 block">
                      <span className={settingsLabel}>{t("settings.organizationLogoUrlLabel")}</span>
                      <input
                        type="url"
                        value={organizationLogoUrlInput}
                        onChange={(e) => setOrganizationLogoUrlInput(e.target.value)}
                        placeholder={t("settings.organizationLogoUrlPlaceholder")}
                        className={clsx(settingsInput, "mt-1")}
                        disabled={logoBusy}
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={logoBusy}
                        onClick={() => void handleSaveOrganizationLogoUrl()}
                        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {logoBusy ? t("common.loading") : t("settings.organizationLogoSaveUrl")}
                      </button>
                      <button
                        type="button"
                        disabled={logoBusy}
                        onClick={() => logoFileInputRef.current?.click()}
                        className="btn-secondary px-4 py-2 text-sm"
                      >
                        {t("settings.organizationLogoUpload")}
                      </button>
                      {organizationLogoUrl ? (
                        <button
                          type="button"
                          disabled={logoBusy}
                          onClick={() => void handleClearOrganizationLogo()}
                          className="btn-secondary px-4 py-2 text-sm"
                        >
                          {t("settings.organizationLogoClear")}
                        </button>
                      ) : null}
                    </div>
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      className="hidden"
                      onChange={(e) => void handleOrganizationLogoFile(e.target.files?.[0] ?? null)}
                    />
                  </div>

                  {appearanceSaveError ? (
                    <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      {appearanceSaveError}
                    </p>
                  ) : null}

                  <div className="mb-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-ink-200/80 bg-ink-50/50 p-4 dark:border-white/10 dark:bg-ink-950/40">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                        {t("settings.appearanceLightMode")}
                      </p>
                      <div className="space-y-3">
                        <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{t("settings.appearanceClientBubble")}</p>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.appearanceBubbleBackground")}</span>
                          <input
                            type="color"
                            value={bubbleClientColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleClientColor(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.appearanceBubbleText")}</span>
                          <input
                            type="color"
                            value={bubbleClientTextColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleClientTextColor(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.appearanceBubbleTime")}</span>
                          <input
                            type="color"
                            value={bubbleClientMetaColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleClientMetaColor(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                        <p className="pt-1 text-xs font-medium text-ink-500 dark:text-ink-400">{t("settings.appearanceAgentBubble")}</p>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.appearanceBubbleBackground")}</span>
                          <input
                            type="color"
                            value={bubbleAgentColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentColor(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">
                            {t("settings.appearanceBubbleText")}
                            <span className="mt-0.5 block text-[11px] font-normal text-ink-500 dark:text-ink-400">
                              {t("settings.appearanceBubbleTextHint")}
                            </span>
                          </span>
                          <input
                            type="color"
                            value={bubbleAgentTextColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentTextColor(e.target.value);
                            }}
                            className="h-9 w-14 shrink-0 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.appearanceBubbleTime")}</span>
                          <input
                            type="color"
                            value={bubbleAgentMetaColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentMetaColor(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.appearanceAgentName")}</span>
                          <input
                            type="color"
                            value={bubbleAgentNameColor}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentNameColor(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900"
                          />
                        </label>
                      </div>
                      <div className="mt-4 flex flex-col gap-2 rounded-xl bg-white p-3 dark:bg-ink-900/60">
                        <div
                          className="crm-bubble crm-bubble-in max-w-[85%] self-start border border-ink-200/60 px-3 py-2 text-sm dark:border-white/10"
                          style={bubblePreviewStyle(bubbleClientColor, bubbleClientTextColor, bubbleClientMetaColor)}
                        >
                          <p>{t("settings.appearancePreviewClient")}</p>
                          <div className="crm-bubble-meta mt-1 flex justify-end">
                            <span>14:30</span>
                          </div>
                        </div>
                        <div
                          className="crm-bubble crm-bubble-out max-w-[85%] self-end border border-brand-500/25 px-3 py-2 text-sm dark:border-brand-400/30"
                          style={bubblePreviewStyle(bubbleAgentColor, bubbleAgentTextColor, bubbleAgentMetaColor, bubbleAgentNameColor)}
                        >
                          <p className="crm-bubble-agent-name" style={{ color: bubbleAgentNameColor }}>
                            {t("settings.appearancePreviewAgentName")}
                          </p>
                          <p>{t("settings.appearancePreviewAgent")}</p>
                          <div className="crm-bubble-meta mt-1 flex items-center justify-end gap-1">
                            <span>14:31</span>
                            <CheckCheck className="crm-bubble-read-status is-read h-4 w-4" aria-hidden />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-ink-200/80 bg-ink-950 p-4 dark:border-white/10">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
                        {t("settings.appearanceDarkMode")}
                      </p>
                      <div className="space-y-3">
                        <p className="text-xs font-medium text-ink-400">{t("settings.appearanceClientBubble")}</p>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">{t("settings.appearanceBubbleBackground")}</span>
                          <input
                            type="color"
                            value={bubbleClientDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleClientDark(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">{t("settings.appearanceBubbleText")}</span>
                          <input
                            type="color"
                            value={bubbleClientTextDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleClientTextDark(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">{t("settings.appearanceBubbleTime")}</span>
                          <input
                            type="color"
                            value={bubbleClientMetaDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleClientMetaDark(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <p className="pt-1 text-xs font-medium text-ink-400">{t("settings.appearanceAgentBubble")}</p>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">{t("settings.appearanceBubbleBackground")}</span>
                          <input
                            type="color"
                            value={bubbleAgentDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentDark(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">
                            {t("settings.appearanceBubbleText")}
                            <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
                              {t("settings.appearanceBubbleTextHint")}
                            </span>
                          </span>
                          <input
                            type="color"
                            value={bubbleAgentTextDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentTextDark(e.target.value);
                            }}
                            className="h-9 w-14 shrink-0 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">{t("settings.appearanceBubbleTime")}</span>
                          <input
                            type="color"
                            value={bubbleAgentMetaDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentMetaDark(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-300">{t("settings.appearanceAgentName")}</span>
                          <input
                            type="color"
                            value={bubbleAgentNameDark}
                            onChange={(e) => {
                              setAppearanceUsesDefaults(false);
                              setBubbleAgentNameDark(e.target.value);
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
                          />
                        </label>
                      </div>
                      <div className="mt-4 flex flex-col gap-2 rounded-xl bg-[#0e1624] p-3">
                        <div
                          className="crm-bubble crm-bubble-in max-w-[85%] self-start border border-white/10 px-3 py-2 text-sm"
                          style={bubblePreviewStyle(bubbleClientDark, bubbleClientTextDark, bubbleClientMetaDark)}
                        >
                          <p>{t("settings.appearancePreviewClient")}</p>
                          <div className="crm-bubble-meta mt-1 flex justify-end">
                            <span>14:30</span>
                          </div>
                        </div>
                        <div
                          className="crm-bubble crm-bubble-out max-w-[85%] self-end border border-brand-400/30 px-3 py-2 text-sm"
                          style={bubblePreviewStyle(bubbleAgentDark, bubbleAgentTextDark, bubbleAgentMetaDark, bubbleAgentNameDark)}
                        >
                          <p className="crm-bubble-agent-name" style={{ color: bubbleAgentNameDark }}>
                            {t("settings.appearancePreviewAgentName")}
                          </p>
                          <p>{t("settings.appearancePreviewAgent")}</p>
                          <div className="crm-bubble-meta mt-1 flex items-center justify-end gap-1">
                            <span>14:31</span>
                            <CheckCheck className="crm-bubble-read-status is-read h-4 w-4" aria-hidden />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {saving ? t("common.loading") : t("settings.appearanceSave")}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetAppearance}
                      className="btn-secondary px-4 py-2 text-sm"
                    >
                      {t("settings.appearanceReset")}
                    </button>
                  </div>
                </motion.form>
              )}

              {section === "notifications" && (
                <motion.form
                  onSubmit={(e) => void handleSaveNotifications(e)}
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <Bell className="h-5 w-5" />
                    {t("settings.sectionNotifications")}
                  </h2>
                  <p className="mb-6 text-sm text-ink-500 dark:text-ink-400">
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
                      <label htmlFor="notifyOpen" className="text-sm text-ink-700 dark:text-ink-300">
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
                      <label htmlFor="notifyPending" className="text-sm text-ink-700 dark:text-ink-300">
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
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <Star className="h-5 w-5" />
                    {t("settings.sectionCsat")}
                  </h2>
                  <p className="mb-6 text-sm text-ink-500 dark:text-ink-400">{t("settings.csatIntro")}</p>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        id="csatEnabled"
                        type="checkbox"
                        checked={csatEnabled}
                        onChange={(e) => setCsatEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="csatEnabled" className="text-sm text-ink-700 dark:text-ink-300">
                        {t("settings.csatEnable")}
                      </label>
                    </div>
                    <div>
                      <label htmlFor="csatSurveyMessage" className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                        {t("settings.csatMessageLabel")}
                      </label>
                      <textarea
                        id="csatSurveyMessage"
                        value={csatSurveyMessage}
                        onChange={(e) => setCsatSurveyMessage(e.target.value)}
                        rows={3}
                        className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.csatMessageHint")}</p>
                    </div>
                    <div>
                      <label htmlFor="csatRatingType" className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                        {t("settings.csatRatingTypeLabel")}
                      </label>
                      <select
                        id="csatRatingType"
                        value={csatRatingType}
                        onChange={(e) => setCsatRatingType(e.target.value as CsatRatingType)}
                        className="mt-1 block w-full max-w-xs input-field"
                      >
                        <option value="number">{t("settings.csatRatingTypeNumber")}</option>
                        <option value="star">{t("settings.csatRatingTypeStar")}</option>
                        <option value="emoji">{t("settings.csatRatingTypeEmoji")}</option>
                      </select>
                      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.csatRatingTypeHint")}</p>
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

              {section === "sla" && isAdmin ? (
                <motion.div variants={staggerItem}>
                  <SlaPoliciesSettings />
                </motion.div>
              ) : null}

              {section === "canned" && isAdmin ? (
                <motion.div variants={staggerItem}>
                  <CannedResponsesSettings />
                </motion.div>
              ) : null}

              {section === "workflow" && (
                <motion.form
                  onSubmit={(e) => void handleSaveWorkflow(e)}
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <GitBranch className="h-5 w-5" />
                    {t("settings.workflowTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-ink-500 dark:text-ink-400">{t("settings.workflowIntro")}</p>

                  <div className="mb-6 flex flex-col gap-2 border-b border-gray-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{t("settings.workflowAttendanceTab")}</p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowAttendanceTabHint")}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={wfAttendanceTabEnabled}
                      onClick={() => setWfAttendanceTabEnabled((v) => !v)}
                      className={clsx(
                        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2",
                        wfAttendanceTabEnabled ? "bg-brand-500" : "bg-gray-200",
                      )}
                    >
                      <span
                        className={clsx(
                          "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
                          wfAttendanceTabEnabled ? "translate-x-5" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>

                  {wfAttendanceTabEnabled && (
                    <div className="mb-6 flex flex-col gap-2 border-b border-gray-100 pb-6 pl-4 sm:flex-row sm:items-center sm:justify-between sm:pl-6">
                      <div>
                        <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{t("settings.workflowAttendanceTabAutoOpen")}</p>
                        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowAttendanceTabAutoOpenHint")}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={wfAttendanceTabAutoOpen}
                        onClick={() => setWfAttendanceTabAutoOpen((v) => !v)}
                        className={clsx(
                          "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2",
                          wfAttendanceTabAutoOpen ? "bg-brand-500" : "bg-gray-200",
                        )}
                      >
                        <span
                          className={clsx(
                            "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
                            wfAttendanceTabAutoOpen ? "translate-x-5" : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>
                  )}

                  <div className="mb-6 flex flex-col gap-2 border-b border-gray-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{t("settings.workflowListShowTags")}</p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowListShowTagsHint")}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={wfListShowContactTags}
                      onClick={() => setWfListShowContactTags((v) => !v)}
                      className={clsx(
                        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2",
                        wfListShowContactTags ? "bg-brand-500" : "bg-gray-200",
                      )}
                    >
                      <span
                        className={clsx(
                          "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition",
                          wfListShowContactTags ? "translate-x-5" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>

                  <div className="flex flex-col gap-4 border-b border-gray-100 pb-6">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{t("settings.workflowAutoResolve")}</p>
                        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowAutoResolveHint")}</p>
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
                          <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                            {t("settings.workflowInactivityValue")}
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={wfInactivityValue}
                            onChange={(e) => setWfInactivityValue(Number(e.target.value))}
                            className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <div className="min-w-[140px]">
                          <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                            {t("settings.workflowInactivityUnit")}
                          </label>
                          <select
                            value={wfInactivityUnit}
                            onChange={(e) =>
                              setWfInactivityUnit(e.target.value as "minutes" | "hours" | "days")
                            }
                            className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          >
                            <option value="minutes">{t("settings.workflowUnitMinutes")}</option>
                            <option value="hours">{t("settings.workflowUnitHours")}</option>
                            <option value="days">{t("settings.workflowUnitDays")}</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowInactivityHint")}</p>

                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.workflowCustomerMessage")}
                        </label>
                        <textarea
                          value={wfCustomerMessage}
                          onChange={(e) => setWfCustomerMessage(e.target.value)}
                          rows={4}
                          className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          placeholder={t("settings.workflowCustomerMessagePlaceholder")}
                        />
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowCustomerMessageHint")}</p>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{t("settings.workflowSkipAssigned")}</p>
                          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowSkipAssignedHint")}</p>
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
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.workflowAutoLeadType")}
                        </label>
                        <select
                          value={wfAutoLeadTypeId}
                          onChange={(e) => setWfAutoLeadTypeId(e.target.value)}
                          className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">{t("settings.workflowSelectLeadType")}</option>
                          {leadTypes.map((lt) => (
                            <option key={lt.id} value={lt.id}>
                              {lt.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowAutoLeadTypeHint")}</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                          {t("settings.workflowTagAfterResolve")}
                        </label>
                        <select
                          value={wfTagId}
                          onChange={(e) => setWfTagId(e.target.value)}
                          className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
                    <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("settings.workflowManualTitle")}</h3>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowManualIntro")}</p>
                    <div className="flex items-center gap-3">
                      <input
                        id="wfReqClosure"
                        type="checkbox"
                        checked={wfRequireClosure}
                        onChange={(e) => setWfRequireClosure(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="wfReqClosure" className="text-sm text-ink-700 dark:text-ink-300">
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
                      <label htmlFor="wfReqLead" className="text-sm text-ink-700 dark:text-ink-300">
                        {t("settings.workflowRequireLeadType")}
                      </label>
                    </div>
                    <div className="flex items-start gap-3">
                      <input
                        id="wfOfferReminder"
                        type="checkbox"
                        checked={wfOfferReminder}
                        onChange={(e) => setWfOfferReminder(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <div>
                        <label htmlFor="wfOfferReminder" className="text-sm text-ink-700 dark:text-ink-300">
                          {t("settings.workflowOfferReminder")}
                        </label>
                        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("settings.workflowOfferReminderHint")}</p>
                      </div>
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
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <Sparkles className="h-5 w-5" />
                    {t("settings.assistantTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-ink-500 dark:text-ink-400">{t("settings.assistantIntro")}</p>
                  {assistantKeyMasked ? (
                    <p className="mb-4 rounded-lg border border-brand-100 bg-brand-50/50 px-3 py-2 text-sm text-brand-900">
                      {t("settings.assistantKeyActiveHint")}
                    </p>
                  ) : null}
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="assistantOpenaiKey" className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                        {t("settings.assistantApiKeyLabel")}
                      </label>
                      <input
                        id="assistantOpenaiKey"
                        type="password"
                        autoComplete="off"
                        value={assistantOpenaiKey}
                        onChange={(e) => setAssistantOpenaiKey(e.target.value)}
                        className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder={assistantKeyMasked ? "••••••••" : ""}
                      />
                      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.assistantApiKeyHint")}</p>
                    </div>
                    <div>
                      <label htmlFor="assistantOpenaiBaseUrl" className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                        {t("settings.assistantApiBaseUrlLabel")}
                      </label>
                      <input
                        id="assistantOpenaiBaseUrl"
                        type="url"
                        value={assistantOpenaiBaseUrl}
                        onChange={(e) => setAssistantOpenaiBaseUrl(e.target.value)}
                        className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="https://api.openai.com/v1"
                      />
                      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.assistantApiBaseUrlHint")}</p>
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

              {section === "leadFinder" && showLeadFinder ? (
                <motion.form
                  onSubmit={(e) => void handleSaveLeadFinder(e)}
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <Search className="h-5 w-5" />
                    {t("settings.leadFinderTitle")}
                  </h2>
                  <p className="mb-6 text-sm text-ink-500 dark:text-ink-400">{t("settings.leadFinderIntro")}</p>
                  {leadFinderKeyMasked ? (
                    <p className="mb-4 rounded-lg border border-brand-100 bg-brand-50/50 px-3 py-2 text-sm text-brand-900">
                      {t("settings.leadFinderKeyActiveHint")}
                    </p>
                  ) : null}
                  <div>
                    <label htmlFor="leadFinderSerpApiKey" className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                      {t("settings.leadFinderApiKeyLabel")}
                    </label>
                    <input
                      id="leadFinderSerpApiKey"
                      type="password"
                      autoComplete="off"
                      value={leadFinderSerpApiKey}
                      onChange={(e) => setLeadFinderSerpApiKey(e.target.value)}
                      className="mt-1 block w-full input-field text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      placeholder={leadFinderKeyMasked ? "••••••••" : ""}
                    />
                    <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.leadFinderApiKeyHint")}</p>
                  </div>
                  {leadFinderSaveError ? (
                    <p className="mt-4 text-sm text-red-600" role="alert">
                      {leadFinderSaveError}
                    </p>
                  ) : null}
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {saving ? t("common.loading") : t("settings.leadFinderSave")}
                    </button>
                    {leadFinderKeyMasked ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleRemoveLeadFinderKey()}
                        className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("settings.leadFinderRemoveKey")}
                      </button>
                    ) : null}
                  </div>
                </motion.form>
              ) : null}

              {section === "crm" && (
                <motion.div
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <Tag className="h-5 w-5" />
                    {t("settings.leadTypesTitle")}
                  </h2>
                  <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">{t("settings.leadTypesHint")}</p>
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
                            <span className="flex items-center gap-2 text-sm font-medium text-ink-900 dark:text-ink-50 dark:text-ink-100">
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
                    <ul className="mb-4 divide-y divide-ink-100 dark:divide-white/10 rounded-lg border border-ink-200/80 dark:border-white/10">
                      {leadTypes.map((lt) => (
                        <li key={lt.id} className="px-3 py-3 text-sm">
                          {editingLtId === lt.id ? (
                            <form
                              onSubmit={(e) => void handleSaveEditLeadType(e, lt.id)}
                              className="space-y-3"
                            >
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="min-w-[140px] flex-1">
                                  <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                                    {t("settings.leadTypeName")}
                                  </label>
                                  <input
                                    value={editLtName}
                                    onChange={(e) => setEditLtName(e.target.value)}
                                    className="mt-1 w-full input-field"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
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
                                <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                                  {t("settings.leadTypeValueRollup")}
                                </label>
                                <select
                                  value={editLtRollup}
                                  onChange={(e) =>
                                    setEditLtRollup(e.target.value as LeadTypeRow["valueRollup"])
                                  }
                                  className="mt-1 w-full max-w-md input-field"
                                >
                                  <option value="PIPELINE">{t("settings.leadTypeRollupPipeline")}</option>
                                  <option value="WON">{t("settings.leadTypeRollupWon")}</option>
                                  <option value="LOST">{t("settings.leadTypeRollupLost")}</option>
                                  <option value="NONE">{t("settings.leadTypeRollupNone")}</option>
                                </select>
                                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("settings.leadTypeRollupWonHint")}</p>
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
                                <span className="flex items-center gap-2 font-medium text-ink-900 dark:text-ink-50">
                                  <span
                                    className="h-3 w-3 shrink-0 rounded-full"
                                    style={{ backgroundColor: lt.color }}
                                  />
                                  {lt.name}
                                </span>
                                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
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
                    <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">{t("settings.noLeadTypes")}</p>
                  )}
                  <form onSubmit={handleAddLeadType} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[160px] flex-1">
                      <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                        {t("settings.leadTypeName")}
                      </label>
                      <input
                        value={newLtName}
                        onChange={(e) => setNewLtName(e.target.value)}
                        className="mt-1 w-full input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
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
                      <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                        {t("settings.leadTypeValueRollup")}
                      </label>
                      <select
                        value={newLtRollup}
                        onChange={(e) =>
                          setNewLtRollup(e.target.value as LeadTypeRow["valueRollup"])
                        }
                        className="mt-1 w-full input-field"
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
                  <p className="mt-3 text-xs text-ink-400 dark:text-ink-500">{t("settings.saveLeadTypesNote")}</p>
                </motion.div>
              )}

              {section === "templates" && (
                <WhatsAppMessageTemplatesSection
                  waInboxes={waInboxes}
                  defaultWaInboxId={defaultWaInbox?.id}
                  orgSettings={
                    settings
                      ? {
                          whatsappProvider: settings.whatsappProvider,
                          whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
                          whatsappApiKey: settings.whatsappApiKey,
                        }
                      : null
                  }
                />
              )}

              {section === "tags" && (
                <motion.div variants={staggerItem}>
                  <OrganizationTagsPanel />
                </motion.div>
              )}

              {section === "team" && (
                <motion.div
                  className="card-surface rounded-xl p-6"
                  variants={staggerItem}
                >
                  <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
                    <UserPlus className="h-5 w-5" />
                    {t("settings.sectionTeam")}
                  </h2>
                  <TeamSettingsPanel isAdmin={isAdmin} currentUserId={user?.id} />
                </motion.div>
              )}

              {section === "wavoip" && showWavoip && (
                <motion.div className="card-surface rounded-xl p-6" variants={staggerItem}>
                  <WavoipIntegrationSettings />
                </motion.div>
              )}

              {section === "threecx" && showThreeCx && (
                <motion.div className="card-surface rounded-xl p-6" variants={staggerItem}>
                  <ThreeCxIntegrationSettings />
                </motion.div>
              )}

              {section === "nvoip" && showNvoip && (
                <motion.div className="card-surface rounded-xl p-6" variants={staggerItem}>
                  <NvoipIntegrationSettings />
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
