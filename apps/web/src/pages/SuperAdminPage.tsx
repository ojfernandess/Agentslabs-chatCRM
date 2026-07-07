import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Building2,
  Copy,
  Check,
  Users,
  MessagesSquare,
  UserCircle,
  Search,
  Crown,
  Pencil,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import {
  SuperAdminShell,
  SuperAdminPageHeader,
  SuperAdminMetricCard,
  SuperAdminPanel,
  type SuperSection,
} from "@/components/super-admin/SuperAdminShell";
import { PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY } from "@/lib/publicDocsSettings";
import { ResendPasswordResetTemplateEditor } from "@/components/ResendPasswordResetTemplateEditor";
import { ResendUserInviteTemplateEditor } from "@/components/ResendUserInviteTemplateEditor";
import { SuperAdminConversationMediaSection } from "@/components/super-admin/SuperAdminConversationMediaSection";
import { invalidateTurnstileConfigCache } from "@/hooks/useTurnstileConfig";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  planTier?: string;
  billingEmail?: string | null;
  monthlyMessageQuota?: number | null;
  _count: { users: number; contacts: number; conversations: number };
}

interface SuperStats {
  organizationTotal: number;
  organizationActive: number;
  organizationSuspended: number;
  userTotal: number;
  contactTotal: number;
  conversationOpen: number | null;
}

function deriveStatsFromOrgs(orgs: OrgRow[]): SuperStats {
  const organizationTotal = orgs.length;
  const organizationActive = orgs.filter((o) => o.isActive).length;
  return {
    organizationTotal,
    organizationActive,
    organizationSuspended: organizationTotal - organizationActive,
    userTotal: orgs.reduce((s, o) => s + o._count.users, 0),
    contactTotal: orgs.reduce((s, o) => s + o._count.contacts, 0),
    conversationOpen: null,
  };
}

interface SuperOrganizationsPayload {
  organizations: OrgRow[];
  stats: {
    organizationTotal: number;
    organizationActive: number;
    organizationSuspended: number;
    userTotal: number;
    contactTotal: number;
    conversationOpen: number;
  };
}

function isOrgListPayload(x: unknown): x is OrgRow[] {
  return Array.isArray(x);
}

function isWrappedOrganizations(x: unknown): x is SuperOrganizationsPayload {
  return (
    x !== null &&
    typeof x === "object" &&
    "organizations" in x &&
    "stats" in x &&
    Array.isArray((x as SuperOrganizationsPayload).organizations)
  );
}

interface MonitoringPayload {
  database: { ok: boolean; latencyMs: number };
  redis: { ok: boolean; latencyMs: number; error?: string };
  backgroundJobs: { mode: string; note: string };
}

interface PlatformAppRow {
  id: string;
  name: string;
  description: string | null;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: { id: string; email: string; name: string };
}

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  createdAt: string;
  metadata: unknown;
  actor: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string } | null;
}

interface AuditPage {
  data: AuditRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FeatureFlagRow {
  key: string;
  /** Estado efectivo para o tenant (inclui legacy Wavoip com dispositivos pareados). */
  enabled: boolean;
  defaultEnabled: boolean;
  configuredInDb: boolean;
  dbEnabled: boolean | null;
}

interface FeatureFlagsPayload {
  organizationId: string;
  organizationName: string;
  wavoipDiagnostics?: {
    deviceCount: number;
    lastLog: {
      eventType: string;
      message: string;
      level: string;
      createdAt: string;
    } | null;
  };
  nvoipDiagnostics?: {
    hasAccount: boolean;
    accountStatus: string | null;
    numbersip: string | null;
    lastBalance: string | null;
    callCount30d: number;
    lastLog: {
      eventType: string;
      message: string;
      level: string;
      createdAt: string;
    } | null;
  };
  flags: FeatureFlagRow[];
}

interface NvoipPlatformMetricsPayload {
  periodDays: number;
  organizationsWithAccount: number;
  connectedAccounts: number;
  calls: { total: number; totalDurationSec: number };
  torpedoDispatches: number;
  estimatedCostBrl: number | null;
  topOrganizations: {
    organizationId: string;
    organizationName: string;
    callCount: number;
    durationSec: number;
  }[];
}

interface UsageOrgRow {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  isActive: boolean;
  messagesLast7Days: number;
  messagesLast30Days: number;
}

interface UsageMetricsPayload {
  windows: { shortDays: number; longDays: number };
  organizations: UsageOrgRow[];
}

interface PlatformSettingRow {
  id: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

interface OrgUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface PlatformUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  organizationId: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
  } | null;
}

interface PlatformUsersPage {
  data: PlatformUserRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  summary: { superAdminTotal: number; unassignedTotal: number };
}

interface SuperWhatsAppEmbeddedPayload {
  configured: boolean;
  appId: string;
  configurationId: string;
  apiVersion: string;
  webhookVerifyToken: string;
  appSecretMasked: string;
  metaWebhookCallbackUrl: string;
}

interface SuperEvolutionPlatformPayload {
  enabled: boolean;
  tenantQrOnly: boolean;
  baseUrl: string;
  globalApiKeyMasked: string;
  configured: boolean;
}

interface SuperEvolutionGoPlatformPayload {
  enabled: boolean;
  baseUrl: string;
  globalApiKeyMasked: string;
  configured: boolean;
}

interface SuperResendPayload {
  configured: boolean;
  fromEmail: string;
  fromName: string;
  apiKeyMasked: string;
  systemLogoUrl?: string;
  passwordResetSubject: string;
  passwordResetHtmlTemplate: string;
  userInviteSubject: string;
  userInviteHtmlTemplate: string;
}

interface SuperTurnstilePayload {
  enabled: boolean;
  siteKey: string;
  secretKeyMasked: string;
  configured: boolean;
}

interface SuperMediaStoragePayload {
  configured: boolean;
  enabled: boolean;
  driver: "local" | "minio";
  endpoint: string;
  bucket: string;
  accessKeyMasked: string;
  secretKeyMasked: string;
  useSsl: boolean;
  region: string;
  publicBaseUrl: string;
  source: "env" | "platform";
}

export function SuperAdminPage() {
  const { t } = useI18n();
  const { user, logout, enterOrganization, applySessionToken } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<SuperSection>("overview");
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [stats, setStats] = useState<SuperStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [monitoring, setMonitoring] = useState<MonitoringPayload | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);

  const [platformApps, setPlatformApps] = useState<PlatformAppRow[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [appName, setAppName] = useState("");
  const [appDesc, setAppDesc] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  const [auditPage, setAuditPage] = useState(1);
  const [auditData, setAuditData] = useState<AuditPage | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const [flagsOrgId, setFlagsOrgId] = useState<string>("");
  const [flagsPayload, setFlagsPayload] = useState<FeatureFlagsPayload | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagBusy, setFlagBusy] = useState<string | null>(null);

  const [usageMetrics, setUsageMetrics] = useState<UsageMetricsPayload | null>(null);
  const [nvoipMetrics, setNvoipMetrics] = useState<NvoipPlatformMetricsPayload | null>(null);
  const [nvoipMetricsLoading, setNvoipMetricsLoading] = useState(false);
  const [nvoipMetricsError, setNvoipMetricsError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingRow[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [publicDocsBusy, setPublicDocsBusy] = useState(false);
  const [settingKeyInput, setSettingKeyInput] = useState("maintenance_mode");
  const [settingValueInput, setSettingValueInput] = useState('{"enabled":false}');
  const [billingOrg, setBillingOrg] = useState<OrgRow | null>(null);
  const [billingPlanTier, setBillingPlanTier] = useState("free");
  const [billingEmailState, setBillingEmailState] = useState("");
  const [billingQuota, setBillingQuota] = useState("");
  const [billingSaving, setBillingSaving] = useState(false);
  const [editOrg, setEditOrg] = useState<OrgRow | null>(null);
  const [editOrgName, setEditOrgName] = useState("");
  const [editOrgSlug, setEditOrgSlug] = useState("");
  const [editOrgActive, setEditOrgActive] = useState(true);
  const [editOrgPlan, setEditOrgPlan] = useState("free");
  const [editOrgSaving, setEditOrgSaving] = useState(false);
  const [deleteOrgConfirm, setDeleteOrgConfirm] = useState<OrgRow | null>(null);
  const [deleteOrgBusy, setDeleteOrgBusy] = useState(false);
  const [usersOrg, setUsersOrg] = useState<OrgRow | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userRoleBusy, setUserRoleBusy] = useState<string | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState<string | null>(null);

  const [platformUsersPage, setPlatformUsersPage] = useState(1);
  const [platformUsersQ, setPlatformUsersQ] = useState("");
  const [platformUsersRole, setPlatformUsersRole] = useState("");
  const [platformUsersOrgId, setPlatformUsersOrgId] = useState("");
  const [platformUsersUnassigned, setPlatformUsersUnassigned] = useState(false);
  const [platformUsersData, setPlatformUsersData] = useState<PlatformUsersPage | null>(null);
  const [platformUsersLoading, setPlatformUsersLoading] = useState(false);
  const [editPlatformUser, setEditPlatformUser] = useState<PlatformUserRow | null>(null);
  const [editUserName, setEditUserName] = useState("");
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserRole, setEditUserRole] = useState<"SUPER_ADMIN" | "ADMIN" | "AGENT">("AGENT");
  const [editUserOrgId, setEditUserOrgId] = useState("");
  const [editUserSaving, setEditUserSaving] = useState(false);
  const [editUserDeleting, setEditUserDeleting] = useState(false);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<PlatformUserRow | null>(null);
  const [platformUsersSuccess, setPlatformUsersSuccess] = useState("");

  const [waEmbLoad, setWaEmbLoad] = useState(false);
  const [waEmbLoadFailed, setWaEmbLoadFailed] = useState(false);
  const [waEmbRefresh, setWaEmbRefresh] = useState(0);
  const [waEmbSave, setWaEmbSave] = useState(false);
  const [waEmbSnapshot, setWaEmbSnapshot] = useState<SuperWhatsAppEmbeddedPayload | null>(null);
  const [waEmbAppId, setWaEmbAppId] = useState("");
  const [waEmbAppSecret, setWaEmbAppSecret] = useState("");
  const [waEmbConfigurationId, setWaEmbConfigurationId] = useState("");
  const [waEmbApiVersion, setWaEmbApiVersion] = useState("v22.0");
  const [waEmbVerifyToken, setWaEmbVerifyToken] = useState("");
  const [waEmbCallbackCopied, setWaEmbCallbackCopied] = useState(false);

  const [evoPlLoad, setEvoPlLoad] = useState(false);
  const [evoPlLoadFailed, setEvoPlLoadFailed] = useState(false);
  const [evoPlRefresh, setEvoPlRefresh] = useState(0);
  const [evoPlSave, setEvoPlSave] = useState(false);
  const [evoPlSnapshot, setEvoPlSnapshot] = useState<SuperEvolutionPlatformPayload | null>(null);
  const [evoPlEnabled, setEvoPlEnabled] = useState(false);
  const [evoPlBaseUrl, setEvoPlBaseUrl] = useState("");
  const [evoPlGlobalApiKey, setEvoPlGlobalApiKey] = useState("");

  const [evoGoLoad, setEvoGoLoad] = useState(false);
  const [evoGoLoadFailed, setEvoGoLoadFailed] = useState(false);
  const [evoGoRefresh, setEvoGoRefresh] = useState(0);
  const [evoGoSave, setEvoGoSave] = useState(false);
  const [evoGoSnapshot, setEvoGoSnapshot] = useState<SuperEvolutionGoPlatformPayload | null>(null);
  const [evoGoEnabled, setEvoGoEnabled] = useState(false);
  const [evoGoBaseUrl, setEvoGoBaseUrl] = useState("");
  const [evoGoGlobalApiKey, setEvoGoGlobalApiKey] = useState("");

  const [resendLoad, setResendLoad] = useState(false);
  const [resendSnapshot, setResendSnapshot] = useState<SuperResendPayload>({
    configured: false,
    fromEmail: "",
    fromName: "OpenNexo CRM",
    apiKeyMasked: "",
    systemLogoUrl: "",
    passwordResetSubject: "",
    passwordResetHtmlTemplate: "",
    userInviteSubject: "",
    userInviteHtmlTemplate: "",
  });
  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFromEmail, setResendFromEmail] = useState("");
  const [resendFromName, setResendFromName] = useState("OpenNexo CRM");
  const [resendSaving, setResendSaving] = useState(false);
  const [resendSystemLogoUrl, setResendSystemLogoUrl] = useState("");
  const [resendPasswordResetSubject, setResendPasswordResetSubject] = useState("");
  const [resendPasswordResetHtml, setResendPasswordResetHtml] = useState("");
  const [resendUserInviteSubject, setResendUserInviteSubject] = useState("");
  const [resendUserInviteHtml, setResendUserInviteHtml] = useState("");

  const [turnstileLoad, setTurnstileLoad] = useState(false);
  const [turnstileSaving, setTurnstileSaving] = useState(false);
  const [turnstileSnapshot, setTurnstileSnapshot] = useState<SuperTurnstilePayload>({
    enabled: false,
    siteKey: "",
    secretKeyMasked: "",
    configured: false,
  });
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileSecretKey, setTurnstileSecretKey] = useState("");

  const [mediaStorageLoad, setMediaStorageLoad] = useState(false);
  const [mediaStorageSaving, setMediaStorageSaving] = useState(false);
  const [mediaStorageSnapshot, setMediaStorageSnapshot] = useState<SuperMediaStoragePayload>({
    configured: false,
    enabled: false,
    driver: "local",
    endpoint: "",
    bucket: "",
    accessKeyMasked: "",
    secretKeyMasked: "",
    useSsl: false,
    region: "us-east-1",
    publicBaseUrl: "",
    source: "env",
  });
  const [mediaStorageEnabled, setMediaStorageEnabled] = useState(false);
  const [mediaStorageDriver, setMediaStorageDriver] = useState<"local" | "minio">("local");
  const [mediaStorageEndpoint, setMediaStorageEndpoint] = useState("");
  const [mediaStorageBucket, setMediaStorageBucket] = useState("");
  const [mediaStorageAccessKey, setMediaStorageAccessKey] = useState("");
  const [mediaStorageSecretKey, setMediaStorageSecretKey] = useState("");
  const [mediaStorageUseSsl, setMediaStorageUseSsl] = useState(false);
  const [mediaStorageRegion, setMediaStorageRegion] = useState("us-east-1");
  const [mediaStoragePublicBaseUrl, setMediaStoragePublicBaseUrl] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const raw = await api.get<unknown>("/super/organizations");
      let orgData: OrgRow[];

      if (isWrappedOrganizations(raw)) {
        orgData = raw.organizations;
        setOrgs(orgData);
        setStats(raw.stats);
        return;
      }

      if (isOrgListPayload(raw)) {
        orgData = raw;
      } else {
        throw new Error("Invalid organizations response");
      }

      setOrgs(orgData);

      try {
        const statData = await api.get<{
          organizationTotal: number;
          organizationActive: number;
          organizationSuspended: number;
          userTotal: number;
          contactTotal: number;
          conversationOpen: number;
        }>("/super/stats");
        setStats(statData);
      } catch {
        setStats(deriveStatsFromOrgs(orgData));
      }
    } catch {
      setError("Não foi possível carregar dados da plataforma.");
      setOrgs([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (orgs.length > 0 && !flagsOrgId) {
      setFlagsOrgId(orgs[0].id);
    }
  }, [orgs, flagsOrgId]);

  const fetchMonitoring = useCallback(async () => {
    setMonitoringLoading(true);
    try {
      const data = await api.get<MonitoringPayload>("/super/monitoring");
      setMonitoring(data);
    } catch {
      setMonitoring(null);
    } finally {
      setMonitoringLoading(false);
    }
  }, []);

  const fetchPlatformApps = useCallback(async () => {
    setPlatformLoading(true);
    try {
      const data = await api.get<PlatformAppRow[]>("/super/platform-applications");
      setPlatformApps(data);
    } catch {
      setPlatformApps([]);
    } finally {
      setPlatformLoading(false);
    }
  }, []);

  const fetchAudit = useCallback(async (page: number) => {
    setAuditLoading(true);
    try {
      const data = await api.get<AuditPage>(`/super/audit-logs?page=${page}&limit=30`);
      setAuditData(data);
    } catch {
      setAuditData(null);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const fetchFlags = useCallback(async (organizationId: string) => {
    if (!organizationId) return;
    setFlagsLoading(true);
    try {
      const data = await api.get<FeatureFlagsPayload>(`/super/organizations/${organizationId}/feature-flags`);
      setFlagsPayload(data);
    } catch {
      setFlagsPayload(null);
    } finally {
      setFlagsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "monitoring") void fetchMonitoring();
  }, [section, fetchMonitoring]);

  useEffect(() => {
    if (section === "platformApps") void fetchPlatformApps();
  }, [section, fetchPlatformApps]);

  useEffect(() => {
    if (section === "auditLog") void fetchAudit(auditPage);
  }, [section, auditPage, fetchAudit]);

  useEffect(() => {
    if (section === "featureFlags" && flagsOrgId) void fetchFlags(flagsOrgId);
  }, [section, flagsOrgId, fetchFlags]);

  const fetchPlatformUsers = useCallback(async () => {
    setPlatformUsersLoading(true);
    setPlatformUsersSuccess("");
    try {
      const params = new URLSearchParams({
        page: String(platformUsersPage),
        limit: "25",
      });
      const q = platformUsersQ.trim();
      if (q) params.set("q", q);
      if (platformUsersRole) params.set("role", platformUsersRole);
      if (platformUsersOrgId) params.set("organizationId", platformUsersOrgId);
      if (platformUsersUnassigned) params.set("unassigned", "true");
      const data = await api.get<PlatformUsersPage>(`/super/users?${params.toString()}`);
      setPlatformUsersData(data);
    } catch {
      setPlatformUsersData(null);
      setError("Não foi possível carregar utilizadores.");
    } finally {
      setPlatformUsersLoading(false);
    }
  }, [
    platformUsersPage,
    platformUsersQ,
    platformUsersRole,
    platformUsersOrgId,
    platformUsersUnassigned,
  ]);

  useEffect(() => {
    if (section !== "platformUsers") return;
    void fetchPlatformUsers();
  }, [section, fetchPlatformUsers]);

  const fetchUsageMetrics = useCallback(async () => {
    setUsageLoading(true);
    try {
      const data = await api.get<UsageMetricsPayload>("/super/usage-metrics");
      setUsageMetrics(data);
    } catch {
      setUsageMetrics(null);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const fetchNvoipMetrics = useCallback(async () => {
    setNvoipMetricsLoading(true);
    setNvoipMetricsError(null);
    try {
      const data = await api.get<NvoipPlatformMetricsPayload>("/super/nvoip/metrics?days=30");
      setNvoipMetrics(data);
    } catch (e) {
      setNvoipMetrics(null);
      setNvoipMetricsError(
        e instanceof ApiError ? e.message : t("superAdmin.nvoipMetricsLoadError"),
      );
    } finally {
      setNvoipMetricsLoading(false);
    }
  }, [t]);

  const fetchPlatformSettingsList = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const data = await api.get<PlatformSettingRow[]>("/super/platform-settings");
      setPlatformSettings(data);
    } catch {
      setPlatformSettings([]);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const publicDocsEnabled = useMemo(() => {
    const row = platformSettings.find((s) => s.key === PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY);
    if (!row) return false;
    if (row.value === true) return true;
    if (typeof row.value === "object" && row.value !== null && "enabled" in (row.value as object)) {
      return Boolean((row.value as { enabled?: unknown }).enabled);
    }
    return false;
  }, [platformSettings]);

  useEffect(() => {
    if (section === "usageMetrics") {
      void fetchUsageMetrics();
      void fetchNvoipMetrics();
    }
  }, [section, fetchUsageMetrics, fetchNvoipMetrics]);

  useEffect(() => {
    if (section === "globalSettings") void fetchPlatformSettingsList();
  }, [section, fetchPlatformSettingsList]);

  useEffect(() => {
    if (section !== "globalSettings") return;
    let cancelled = false;
    setResendLoad(true);
    void api
      .get<SuperResendPayload>("/super/resend-email")
      .then((d) => {
        if (cancelled) return;
        setResendSnapshot(d);
        setResendFromEmail(d.fromEmail);
        setResendFromName(d.fromName || "OpenNexo CRM");
        setResendSystemLogoUrl(d.systemLogoUrl ?? "");
        setResendPasswordResetSubject(d.passwordResetSubject);
        setResendPasswordResetHtml(d.passwordResetHtmlTemplate);
        setResendUserInviteSubject(d.userInviteSubject);
        setResendUserInviteHtml(d.userInviteHtmlTemplate);
        setResendApiKey("");
      })
      .catch(() => {
        if (!cancelled) {
          setResendSnapshot({
            configured: false,
            fromEmail: "",
            fromName: "OpenNexo CRM",
            apiKeyMasked: "",
            systemLogoUrl: "",
            passwordResetSubject: "",
            passwordResetHtmlTemplate: "",
            userInviteSubject: "",
            userInviteHtmlTemplate: "",
          });
          setResendFromEmail("");
          setResendFromName("OpenNexo CRM");
        }
      })
      .finally(() => {
        if (!cancelled) setResendLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "globalSettings") return;
    let cancelled = false;
    setTurnstileLoad(true);
    void api
      .get<SuperTurnstilePayload>("/super/turnstile")
      .then((d) => {
        if (cancelled) return;
        setTurnstileSnapshot(d);
        setTurnstileEnabled(d.enabled);
        setTurnstileSiteKey(d.siteKey);
        setTurnstileSecretKey("");
      })
      .catch(() => {
        if (!cancelled) {
          setTurnstileSnapshot({ enabled: false, siteKey: "", secretKeyMasked: "", configured: false });
          setTurnstileEnabled(false);
          setTurnstileSiteKey("");
        }
      })
      .finally(() => {
        if (!cancelled) setTurnstileLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "globalSettings") return;
    let cancelled = false;
    setMediaStorageLoad(true);
    void api
      .get<SuperMediaStoragePayload>("/super/media-storage")
      .then((d) => {
        if (cancelled) return;
        setMediaStorageSnapshot(d);
        setMediaStorageEnabled(d.enabled);
        setMediaStorageDriver(d.driver);
        setMediaStorageEndpoint(d.endpoint);
        setMediaStorageBucket(d.bucket);
        setMediaStorageUseSsl(d.useSsl);
        setMediaStorageRegion(d.region || "us-east-1");
        setMediaStoragePublicBaseUrl(d.publicBaseUrl);
        setMediaStorageAccessKey("");
        setMediaStorageSecretKey("");
      })
      .catch(() => {
        if (!cancelled) {
          setMediaStorageSnapshot({
            configured: false,
            enabled: false,
            driver: "local",
            endpoint: "",
            bucket: "",
            accessKeyMasked: "",
            secretKeyMasked: "",
            useSsl: false,
            region: "us-east-1",
            publicBaseUrl: "",
            source: "env",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setMediaStorageLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "whatsappEmbedded") return;
    let cancelled = false;
    setWaEmbLoad(true);
    setWaEmbLoadFailed(false);
    setError("");
    void api
      .get<SuperWhatsAppEmbeddedPayload>("/super/whatsapp-embedded")
      .then((d) => {
        if (cancelled) return;
        setWaEmbSnapshot(d);
        setWaEmbAppId(d.appId);
        setWaEmbConfigurationId(d.configurationId);
        setWaEmbApiVersion(d.apiVersion || "v22.0");
        setWaEmbVerifyToken(d.webhookVerifyToken);
        setWaEmbAppSecret("");
      })
      .catch(() => {
        if (!cancelled) setWaEmbLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setWaEmbLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, waEmbRefresh]);

  useEffect(() => {
    if (section !== "evolutionPlatform") return;
    let cancelled = false;
    setEvoPlLoad(true);
    setEvoPlLoadFailed(false);
    setError("");
    void api
      .get<SuperEvolutionPlatformPayload>("/super/evolution-platform")
      .then((d) => {
        if (cancelled) return;
        setEvoPlSnapshot(d);
        setEvoPlEnabled(d.enabled);
        setEvoPlBaseUrl(d.baseUrl);
        setEvoPlGlobalApiKey("");
      })
      .catch(() => {
        if (!cancelled) setEvoPlLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setEvoPlLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, evoPlRefresh]);

  useEffect(() => {
    if (section !== "evolutionGoPlatform") return;
    let cancelled = false;
    setEvoGoLoad(true);
    setEvoGoLoadFailed(false);
    setError("");
    void api
      .get<SuperEvolutionGoPlatformPayload>("/super/evolution-go-platform")
      .then((d) => {
        if (cancelled) return;
        setEvoGoSnapshot(d);
        setEvoGoEnabled(d.enabled);
        setEvoGoBaseUrl(d.baseUrl);
        setEvoGoGlobalApiKey("");
      })
      .catch(() => {
        if (!cancelled) setEvoGoLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setEvoGoLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, evoGoRefresh]);

  useEffect(() => {
    if (!usersOrg) {
      setOrgUsers([]);
      return;
    }
    setUsersLoading(true);
    void api
      .get<OrgUserRow[]>(`/super/organizations/${usersOrg.id}/users`)
      .then(setOrgUsers)
      .catch(() => setOrgUsers([]))
      .finally(() => setUsersLoading(false));
  }, [usersOrg]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const toggleActive = async (id: string, current: boolean) => {
    try {
      await api.patch(`/super/organizations/${id}`, { isActive: !current });
      await load();
    } catch {
      setError("Falha ao atualizar organização.");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post("/super/organizations", {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
      });
      setName("");
      setSlug("");
      await load();
    } catch {
      setError("Não foi possível criar a organização (slug duplicado?).");
    } finally {
      setSubmitting(false);
    }
  };

  const webhookUrlFor = (orgId: string) =>
    `${window.location.origin}/webhooks/whatsapp/${orgId}`;

  const copyWebhook = async (orgId: string) => {
    await navigator.clipboard.writeText(webhookUrlFor(orgId));
    setCopiedId(orgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const onEnterOrg = async (id: string) => {
    setEnteringId(id);
    setError("");
    try {
      await enterOrganization(id);
      navigate("/");
    } catch {
      setError("Não foi possível entrar nesta organização.");
    } finally {
      setEnteringId(null);
    }
  };

  const handleCreatePlatformApp = async (e: FormEvent) => {
    e.preventDefault();
    if (!appName.trim()) return;
    setError("");
    try {
      const res = await api.post<{ token: string; id: string }>("/super/platform-applications", {
        name: appName.trim(),
        description: appDesc.trim() || undefined,
      });
      setNewToken(res.token);
      setAppName("");
      setAppDesc("");
      await fetchPlatformApps();
    } catch {
      setError("Não foi possível criar a aplicação.");
    }
  };

  const handleRevokeApp = async (id: string) => {
    if (!window.confirm("Revogar esta aplicação? Os tokens deixam de funcionar.")) return;
    try {
      await api.delete(`/super/platform-applications/${id}`);
      await fetchPlatformApps();
    } catch {
      setError("Falha ao revogar.");
    }
  };

  const toggleFlag = async (key: string, enabled: boolean) => {
    if (!flagsOrgId) return;
    setFlagBusy(key);
    try {
      await api.patch(`/super/organizations/${flagsOrgId}/feature-flags`, { key, enabled });
      await fetchFlags(flagsOrgId);
    } catch {
      setError("Não foi possível atualizar a funcionalidade.");
    } finally {
      setFlagBusy(null);
    }
  };

  const openBillingModal = (o: OrgRow) => {
    setBillingOrg(o);
    setBillingPlanTier(o.planTier ?? "free");
    setBillingEmailState(o.billingEmail ?? "");
    setBillingQuota(o.monthlyMessageQuota != null ? String(o.monthlyMessageQuota) : "");
  };

  const openEditOrg = (o: OrgRow) => {
    setEditOrg(o);
    setEditOrgName(o.name);
    setEditOrgSlug(o.slug);
    setEditOrgActive(o.isActive);
    setEditOrgPlan(o.planTier ?? "free");
  };

  const saveEditOrg = async (e: FormEvent) => {
    e.preventDefault();
    if (!editOrg) return;
    setEditOrgSaving(true);
    setError("");
    try {
      await api.patch(`/super/organizations/${editOrg.id}`, {
        name: editOrgName.trim(),
        slug: editOrgSlug.trim(),
        isActive: editOrgActive,
        planTier: editOrgPlan,
      });
      setEditOrg(null);
      await load();
    } catch {
      setError(t("superAdmin.orgSaveFailed"));
    } finally {
      setEditOrgSaving(false);
    }
  };

  const deleteOrganization = async () => {
    if (!deleteOrgConfirm) return;
    setDeleteOrgBusy(true);
    setError("");
    try {
      await api.delete(`/super/organizations/${deleteOrgConfirm.id}`);
      setDeleteOrgConfirm(null);
      await load();
    } catch {
      setError(t("superAdmin.orgDeleteFailed"));
    } finally {
      setDeleteOrgBusy(false);
    }
  };

  const submitBilling = async (e: FormEvent) => {
    e.preventDefault();
    if (!billingOrg) return;
    const quotaRaw = billingQuota.trim();
    let monthlyMessageQuota: number | null = null;
    if (quotaRaw !== "") {
      const n = parseInt(quotaRaw, 10);
      if (Number.isNaN(n) || n < 1) {
        setError("Quota inválida.");
        return;
      }
      monthlyMessageQuota = n;
    }
    setBillingSaving(true);
    setError("");
    try {
      await api.patch(`/super/organizations/${billingOrg.id}`, {
        planTier: billingPlanTier,
        billingEmail: billingEmailState.trim() || "",
        monthlyMessageQuota,
      });
      setBillingOrg(null);
      await load();
    } catch {
      setError("Não foi possível guardar plano / faturação.");
    } finally {
      setBillingSaving(false);
    }
  };

  const savePlatformSetting = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(settingValueInput);
    } catch {
      setError("Valor JSON inválido.");
      return;
    }
    try {
      await api.put("/super/platform-settings", {
        key: settingKeyInput.trim(),
        value: parsed,
      });
      await fetchPlatformSettingsList();
    } catch {
      setError("Não foi possível guardar a definição.");
    }
  };

  const savePublicDocsVisibility = async (enabled: boolean) => {
    setPublicDocsBusy(true);
    setError("");
    try {
      await api.put("/super/platform-settings", {
        key: PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY,
        value: enabled,
      });
      await fetchPlatformSettingsList();
    } catch {
      setError(t("superAdmin.publicApiDocsSaveError"));
    } finally {
      setPublicDocsBusy(false);
    }
  };

  const saveMediaStorage = async (e: FormEvent) => {
    e.preventDefault();
    setMediaStorageSaving(true);
    setError("");
    try {
      const body: {
        enabled: boolean;
        driver: "local" | "minio";
        endpoint?: string;
        bucket?: string;
        accessKey?: string;
        secretKey?: string;
        useSsl?: boolean;
        region?: string;
        publicBaseUrl?: string;
      } = {
        enabled: mediaStorageEnabled,
        driver: mediaStorageDriver,
        endpoint: mediaStorageEndpoint.trim(),
        bucket: mediaStorageBucket.trim(),
        useSsl: mediaStorageUseSsl,
        region: mediaStorageRegion.trim() || "us-east-1",
        publicBaseUrl: mediaStoragePublicBaseUrl.trim(),
      };
      if (mediaStorageAccessKey.trim()) body.accessKey = mediaStorageAccessKey.trim();
      if (mediaStorageSecretKey.trim()) body.secretKey = mediaStorageSecretKey.trim();
      const d = await api.put<SuperMediaStoragePayload>("/super/media-storage", body);
      setMediaStorageSnapshot(d);
      setMediaStorageEnabled(d.enabled);
      setMediaStorageDriver(d.driver);
      setMediaStorageEndpoint(d.endpoint);
      setMediaStorageBucket(d.bucket);
      setMediaStorageUseSsl(d.useSsl);
      setMediaStorageRegion(d.region);
      setMediaStoragePublicBaseUrl(d.publicBaseUrl);
      setMediaStorageAccessKey("");
      setMediaStorageSecretKey("");
    } catch {
      setError(t("superAdmin.mediaStorageSaveError"));
    } finally {
      setMediaStorageSaving(false);
    }
  };

  const saveTurnstile = async (e: FormEvent) => {
    e.preventDefault();
    setTurnstileSaving(true);
    setError("");
    try {
      const body: { enabled: boolean; siteKey?: string; secretKey?: string } = {
        enabled: turnstileEnabled,
        siteKey: turnstileSiteKey.trim(),
      };
      if (turnstileSecretKey.trim()) body.secretKey = turnstileSecretKey.trim();
      const d = await api.put<SuperTurnstilePayload>("/super/turnstile", body);
      setTurnstileSnapshot(d);
      setTurnstileEnabled(d.enabled);
      setTurnstileSiteKey(d.siteKey);
      setTurnstileSecretKey("");
      invalidateTurnstileConfigCache();
    } catch {
      setError(t("superAdmin.turnstileSaveError"));
    } finally {
      setTurnstileSaving(false);
    }
  };

  const saveResend = async (e: FormEvent) => {
    e.preventDefault();
    setResendSaving(true);
    setError("");
    try {
      const body: {
        fromEmail: string;
        fromName: string;
        apiKey?: string;
        systemLogoUrl?: string;
        passwordResetSubject: string;
        passwordResetHtmlTemplate: string;
        userInviteSubject: string;
        userInviteHtmlTemplate: string;
      } = {
        fromEmail: resendFromEmail.trim(),
        fromName: (resendFromName.trim() || "OpenNexo CRM").slice(0, 120),
        systemLogoUrl: resendSystemLogoUrl.trim(),
        passwordResetSubject: resendPasswordResetSubject.trim(),
        passwordResetHtmlTemplate: resendPasswordResetHtml,
        userInviteSubject: resendUserInviteSubject.trim(),
        userInviteHtmlTemplate: resendUserInviteHtml,
      };
      if (resendApiKey.trim()) body.apiKey = resendApiKey.trim();
      const d = await api.put<SuperResendPayload>("/super/resend-email", body);
      setResendSnapshot(d);
      setResendSystemLogoUrl(d.systemLogoUrl ?? "");
      setResendPasswordResetSubject(d.passwordResetSubject);
      setResendPasswordResetHtml(d.passwordResetHtmlTemplate);
      setResendUserInviteSubject(d.userInviteSubject);
      setResendUserInviteHtml(d.userInviteHtmlTemplate);
      setResendApiKey("");
    } catch {
      setError("Não foi possível guardar as definições Resend.");
    } finally {
      setResendSaving(false);
    }
  };

  const patchOrgUserRole = async (userId: string, role: "ADMIN" | "AGENT") => {
    if (!usersOrg) return;
    setUserRoleBusy(userId);
    setError("");
    try {
      await api.patch(`/super/organizations/${usersOrg.id}/users/${userId}`, { role });
      const rows = await api.get<OrgUserRow[]>(`/super/organizations/${usersOrg.id}/users`);
      setOrgUsers(rows);
      await load();
    } catch {
      setError("Não foi possível atualizar o utilizador.");
    } finally {
      setUserRoleBusy(null);
    }
  };

  const openEditPlatformUser = (u: PlatformUserRow) => {
    setEditPlatformUser(u);
    setEditUserName(u.name);
    setEditUserEmail(u.email);
    setEditUserRole(u.role as "SUPER_ADMIN" | "ADMIN" | "AGENT");
    setEditUserOrgId(u.organizationId ?? "");
    setPlatformUsersSuccess("");
  };

  const savePlatformUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!editPlatformUser) return;
    const name = editUserName.trim();
    const email = editUserEmail.trim();
    if (!name || !email) {
      setError("Nome e e-mail são obrigatórios.");
      return;
    }
    setEditUserSaving(true);
    setError("");
    setPlatformUsersSuccess("");
    try {
      const body: {
        name: string;
        email: string;
        role: "SUPER_ADMIN" | "ADMIN" | "AGENT";
        organizationId?: string | null;
      } = {
        name,
        email,
        role: editUserRole,
      };
      if (editUserRole === "SUPER_ADMIN") {
        body.organizationId = null;
      } else {
        if (!editUserOrgId.trim()) {
          setError("Selecione uma organização para administradores e agentes.");
          return;
        }
        body.organizationId = editUserOrgId.trim();
      }
      await api.patch(`/super/users/${editPlatformUser.id}`, body);
      setEditPlatformUser(null);
      setPlatformUsersSuccess(t("superAdmin.platformUsersSaved"));
      await fetchPlatformUsers();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o utilizador.");
    } finally {
      setEditUserSaving(false);
    }
  };

  const deletePlatformUser = async (u: PlatformUserRow) => {
    setEditUserDeleting(true);
    setError("");
    setPlatformUsersSuccess("");
    try {
      await api.delete(`/super/users/${u.id}`);
      setDeleteConfirmUser(null);
      setEditPlatformUser(null);
      setPlatformUsersSuccess(t("superAdmin.platformUsersDeleted"));
      await fetchPlatformUsers();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar o utilizador.");
    } finally {
      setEditUserDeleting(false);
    }
  };

  const userInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  };

  const roleBadgeClass = (role: string) => {
    if (role === "SUPER_ADMIN") return "bg-violet-100 text-violet-800 ring-violet-200";
    if (role === "ADMIN") return "bg-brand-50 text-brand-800 ring-brand-200";
    return "bg-ink-100 text-ink-700 ring-ink-200";
  };

  const roleLabel = (role: string) => {
    if (role === "SUPER_ADMIN") return t("superAdmin.roleSuperAdmin");
    if (role === "ADMIN") return t("superAdmin.roleAdmin");
    return t("superAdmin.roleAgent");
  };

  const impersonateOrgUser = async (orgId: string, userId: string) => {
    setImpersonateBusy(userId);
    setError("");
    try {
      const { token } = await api.post<{ token: string }>(
        `/super/organizations/${orgId}/users/${userId}/impersonate`,
      );
      await applySessionToken(token);
      navigate("/");
    } catch {
      setError("Não foi possível iniciar a vista como utilizador.");
    } finally {
      setImpersonateBusy(null);
    }
  };

  const saveWhatsAppEmbedded = async (e: FormEvent) => {
    e.preventDefault();
    setWaEmbSave(true);
    setError("");
    try {
      const body: {
        appId: string;
        configurationId: string;
        apiVersion: string;
        webhookVerifyToken: string;
        appSecret?: string;
      } = {
        appId: waEmbAppId.trim(),
        configurationId: waEmbConfigurationId.trim(),
        apiVersion: waEmbApiVersion.trim() || "v22.0",
        webhookVerifyToken: waEmbVerifyToken.trim(),
      };
      const secret = waEmbAppSecret.trim();
      if (secret) body.appSecret = secret;
      const d = await api.put<SuperWhatsAppEmbeddedPayload>("/super/whatsapp-embedded", body);
      setWaEmbSnapshot(d);
      setWaEmbAppSecret("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setWaEmbSave(false);
    }
  };

  const saveEvolutionPlatform = async (e: FormEvent) => {
    e.preventDefault();
    setEvoPlSave(true);
    setError("");
    try {
      const body: {
        enabled: boolean;
        baseUrl: string;
        globalApiKey?: string;
      } = {
        enabled: evoPlEnabled,
        baseUrl: evoPlBaseUrl.trim(),
      };
      const key = evoPlGlobalApiKey.trim();
      if (key) body.globalApiKey = key;
      const d = await api.put<SuperEvolutionPlatformPayload>("/super/evolution-platform", body);
      setEvoPlSnapshot(d);
      setEvoPlGlobalApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setEvoPlSave(false);
    }
  };

  const saveEvolutionGoPlatform = async (e: FormEvent) => {
    e.preventDefault();
    setEvoGoSave(true);
    setError("");
    try {
      const body: {
        enabled: boolean;
        baseUrl: string;
        globalApiKey?: string;
      } = {
        enabled: evoGoEnabled,
        baseUrl: evoGoBaseUrl.trim(),
      };
      const key = evoGoGlobalApiKey.trim();
      if (key) body.globalApiKey = key;
      const d = await api.put<SuperEvolutionGoPlatformPayload>("/super/evolution-go-platform", body);
      setEvoGoSnapshot(d);
      setEvoGoGlobalApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setEvoGoSave(false);
    }
  };

  const copyWaEmbCallback = async () => {
    const url = waEmbSnapshot?.metaWebhookCallbackUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setWaEmbCallbackCopied(true);
      window.setTimeout(() => setWaEmbCallbackCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar o URL.");
    }
  };

  const flagTitle = (key: string) => t(`superAdmin.flag.${key}`);

  return (
    <>
    <SuperAdminShell
      section={section}
      onSectionChange={setSection}
      userEmail={user?.email}
      onLogout={handleLogout}
      error={error}
    >
{section === "overview" && (
            <div className="space-y-8">
              <SuperAdminPageHeader
                title={t("superAdmin.overview")}
                subtitle={t("superAdmin.overviewSubtitle")}
              />
              {loading || !stats ? (
                <p className="text-sm text-slate-500">{t("common.loading")}</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <SuperAdminMetricCard
                    label={t("superAdmin.organizations")}
                    value={stats.organizationTotal}
                    hint={`${stats.organizationActive} ativas · ${stats.organizationSuspended} suspensas`}
                    accent="violet"
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.platformUsers")}
                    value={stats.userTotal}
                    hint="Admins e agentes (todos os tenants)"
                    accent="emerald"
                  />
                  <SuperAdminMetricCard label="Contactos" value={stats.contactTotal} hint="Todos os tenants" />
                  <SuperAdminMetricCard
                    className="sm:col-span-2 lg:col-span-3"
                    label="Conversas abertas"
                    value={stats.conversationOpen === null ? "—" : stats.conversationOpen}
                    hint={
                      stats.conversationOpen === null
                        ? t("superAdmin.openConversationsHint")
                        : t("superAdmin.openConversationsOk")
                    }
                    accent="amber"
                  />
                </div>
              )}
            </div>
          )}

          {section === "usageMetrics" && (
            <div className="space-y-6">
              <SuperAdminPageHeader
                title={t("superAdmin.usageMetrics")}
                subtitle={t("superAdmin.usageMetricsSubtitle")}
              />
              {usageLoading || !usageMetrics ? (
                <p className="text-sm text-slate-500">{t("common.loading")}</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <SuperAdminMetricCard
                      label={t("superAdmin.usageMetricsStatTenants")}
                      value={usageMetrics.organizations.length}
                      accent="violet"
                    />
                    <SuperAdminMetricCard
                      label={t("superAdmin.usageMetricsStatMsgs7d")}
                      value={usageMetrics.organizations.reduce((s, o) => s + o.messagesLast7Days, 0)}
                      accent="emerald"
                    />
                    <SuperAdminMetricCard
                      label={t("superAdmin.usageMetricsStatMsgs30d")}
                      value={usageMetrics.organizations.reduce((s, o) => s + o.messagesLast30Days, 0)}
                      accent="amber"
                    />
                  </div>
                  <SuperAdminPanel className="overflow-x-auto p-0">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-4 py-3">{t("superAdmin.org")}</th>
                        <th className="px-4 py-3">{t("superAdmin.planColumn")}</th>
                        <th className="px-4 py-3 text-right">{t("superAdmin.msgs7d")}</th>
                        <th className="px-4 py-3 text-right">{t("superAdmin.msgs30d")}</th>
                        <th className="px-4 py-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 text-ink-800">
                      {usageMetrics.organizations.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3 font-medium">
                            {row.name}
                            <span className="block text-xs font-normal text-ink-500">{row.slug}</span>
                          </td>
                          <td className="px-4 py-3">{row.planTier}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.messagesLast7Days}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.messagesLast30Days}</td>
                          <td className="px-4 py-3">{row.isActive ? "Ativa" : "Suspensa"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SuperAdminPanel>

                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          {t("superAdmin.nvoipMetricsTitle")}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">{t("superAdmin.nvoipMetricsSubtitle")}</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
                        disabled={nvoipMetricsLoading}
                        onClick={() => void fetchNvoipMetrics()}
                      >
                        {t("superAdmin.nvoipMetricsRefresh")}
                      </button>
                    </div>
                    {nvoipMetricsError ? (
                      <p className="mt-3 text-sm text-red-600">{nvoipMetricsError}</p>
                    ) : null}
                    {nvoipMetricsLoading && !nvoipMetrics ? (
                      <p className="mt-4 text-sm text-slate-500">{t("common.loading")}</p>
                    ) : nvoipMetrics ? (
                      <>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <SuperAdminMetricCard
                            label={t("superAdmin.nvoipMetricsAccounts")}
                            value={nvoipMetrics.organizationsWithAccount}
                            accent="violet"
                          />
                          <SuperAdminMetricCard
                            label={t("superAdmin.nvoipMetricsConnected")}
                            value={nvoipMetrics.connectedAccounts}
                            accent="emerald"
                          />
                          <SuperAdminMetricCard
                            label={t("superAdmin.nvoipMetricsCalls")}
                            value={nvoipMetrics.calls.total}
                            accent="amber"
                          />
                          <SuperAdminMetricCard
                            label={t("superAdmin.nvoipMetricsDuration")}
                            value={`${Math.floor(nvoipMetrics.calls.totalDurationSec / 60)} min`}
                            accent="violet"
                          />
                          <SuperAdminMetricCard
                            label={t("superAdmin.nvoipMetricsTorpedo")}
                            value={nvoipMetrics.torpedoDispatches}
                            accent="emerald"
                          />
                          <SuperAdminMetricCard
                            label={t("superAdmin.nvoipMetricsCost")}
                            value={
                              nvoipMetrics.estimatedCostBrl != null
                                ? `R$ ${nvoipMetrics.estimatedCostBrl.toFixed(2)}`
                                : "—"
                            }
                            accent="amber"
                          />
                        </div>
                        {nvoipMetrics.topOrganizations.length > 0 ? (
                          <SuperAdminPanel className="mt-4 overflow-x-auto p-0">
                            <p className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase text-slate-600">
                              {t("superAdmin.nvoipMetricsTopOrgs")}
                            </p>
                            <table className="w-full min-w-[480px] text-left text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase text-slate-600">
                                  <th className="px-4 py-2">{t("superAdmin.org")}</th>
                                  <th className="px-4 py-2 text-right">{t("superAdmin.nvoipMetricsCalls")}</th>
                                  <th className="px-4 py-2 text-right">{t("superAdmin.nvoipMetricsDuration")}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {nvoipMetrics.topOrganizations.map((row) => (
                                  <tr key={row.organizationId}>
                                    <td className="px-4 py-2 font-medium">{row.organizationName}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">{row.callCount}</td>
                                    <td className="px-4 py-2 text-right tabular-nums">
                                      {Math.floor(row.durationSec / 60)} min
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </SuperAdminPanel>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          )}

          {section === "platformUsers" && (
            <div className="space-y-6">
              <SuperAdminPageHeader
                title={t("superAdmin.platformUsers")}
                subtitle={t("superAdmin.platformUsersSubtitle")}
              />
              {platformUsersSuccess ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                  {platformUsersSuccess}
                </p>
              ) : null}
              {platformUsersData ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <SuperAdminMetricCard
                    label={t("superAdmin.platformUsersStatTotal")}
                    value={platformUsersData.total}
                    accent="violet"
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.platformUsersStatSuper")}
                    value={platformUsersData.summary.superAdminTotal}
                    accent="amber"
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.platformUsersStatUnassigned")}
                    value={platformUsersData.summary.unassignedTotal}
                    accent="emerald"
                  />
                </div>
              ) : null}
              <SuperAdminPanel className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs font-medium text-ink-600">
                      {t("superAdmin.platformUsersSearch")}
                    </span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                      <input
                        type="search"
                        value={platformUsersQ}
                        onChange={(e) => {
                          setPlatformUsersQ(e.target.value);
                          setPlatformUsersPage(1);
                        }}
                        className="input-field w-full pl-9"
                      />
                    </div>
                  </label>
                  <label className="w-full lg:w-44">
                    <span className="mb-1 block text-xs font-medium text-ink-600">
                      {t("superAdmin.platformUsersFilterRole")}
                    </span>
                    <select
                      value={platformUsersRole}
                      onChange={(e) => {
                        setPlatformUsersRole(e.target.value);
                        setPlatformUsersPage(1);
                      }}
                      className="input-field w-full"
                    >
                      <option value="">{t("superAdmin.platformUsersFilterAllRoles")}</option>
                      <option value="SUPER_ADMIN">{t("superAdmin.roleSuperAdmin")}</option>
                      <option value="ADMIN">{t("superAdmin.roleAdmin")}</option>
                      <option value="AGENT">{t("superAdmin.roleAgent")}</option>
                    </select>
                  </label>
                  <label className="min-w-0 flex-1 lg:max-w-xs">
                    <span className="mb-1 block text-xs font-medium text-ink-600">
                      {t("superAdmin.platformUsersFilterOrg")}
                    </span>
                    <select
                      value={platformUsersOrgId}
                      onChange={(e) => {
                        setPlatformUsersOrgId(e.target.value);
                        setPlatformUsersUnassigned(false);
                        setPlatformUsersPage(1);
                      }}
                      className="input-field w-full"
                      disabled={platformUsersUnassigned}
                    >
                      <option value="">{t("superAdmin.platformUsersFilterAllOrgs")}</option>
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => void fetchPlatformUsers()} className="btn-secondary shrink-0">
                    {t("common.refresh")}
                  </button>
                </div>
              </SuperAdminPanel>
              {platformUsersLoading || !platformUsersData ? (
                <p className="text-sm text-ink-500">{t("common.loading")}</p>
              ) : (
                <SuperAdminPanel className="overflow-hidden p-0">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-4 py-3">{t("superAdmin.platformUsersColUser")}</th>
                        <th className="px-4 py-3">{t("superAdmin.platformUsersColRole")}</th>
                        <th className="px-4 py-3">{t("superAdmin.platformUsersColOrg")}</th>
                        <th className="px-4 py-3 text-right">{t("superAdmin.platformUsersColActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {platformUsersData.data.map((u) => (
                        <tr key={u.id}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink-900">{u.name}</p>
                            <p className="text-xs text-ink-500">{u.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", roleBadgeClass(u.role))}>
                              {roleLabel(u.role)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-ink-700">
                            {u.organization?.name ?? t("superAdmin.platformUsersUnassigned")}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEditPlatformUser(u)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t("superAdmin.platformUsersEdit")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmUser(u)}
                                disabled={u.id === user?.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {t("superAdmin.platformUsersDelete")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SuperAdminPanel>
              )}
            </div>
          )}

          {section === "globalSettings" && (
            <div className="mx-auto max-w-3xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-ink-900">{t("superAdmin.globalSettings")}</h1>
                <p className="mt-1 text-sm text-ink-600">{t("superAdmin.globalSettingsSubtitle")}</p>
              </div>
              <section className="card-surface p-6">
                <h2 className="mb-2 font-semibold text-ink-900">{t("superAdmin.publicApiDocsTitle")}</h2>
                <p className="mb-4 text-sm text-ink-600">{t("superAdmin.publicApiDocsSubtitle")}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-ink-200">
                    <input
                      type="checkbox"
                      checked={publicDocsEnabled}
                      disabled={settingsLoading || publicDocsBusy}
                      onChange={(e) => void savePublicDocsVisibility(e.target.checked)}
                      className="rounded border-ink-300 dark:border-ink-600"
                    />
                    {t("superAdmin.publicApiDocsToggle")}
                  </label>
                  {publicDocsEnabled ? (
                    <a
                      href="/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {t("superAdmin.publicApiDocsOpenPage")} →
                    </a>
                  ) : null}
                </div>
              </section>
              <section className="card-surface p-6">
                <h2 className="mb-2 font-semibold text-ink-900">{t("superAdmin.mediaStorageTitle")}</h2>
                <p className="mb-4 text-sm text-ink-600">{t("superAdmin.mediaStorageSubtitle")}</p>
                {mediaStorageLoad ? (
                  <p className="text-sm text-ink-500">{t("common.loading")}</p>
                ) : (
                  <form onSubmit={(e) => void saveMediaStorage(e)} className="space-y-4">
                    {mediaStorageSnapshot.source === "env" && !mediaStorageSnapshot.enabled ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                        {t("superAdmin.mediaStorageEnvHint")}
                      </p>
                    ) : null}
                    {mediaStorageSnapshot.configured ? (
                      <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
                        {t("superAdmin.mediaStorageConfigured")}
                      </p>
                    ) : mediaStorageEnabled ? (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                        {t("superAdmin.mediaStorageIncomplete")}
                      </p>
                    ) : null}
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800 dark:text-ink-200">
                      <input
                        type="checkbox"
                        checked={mediaStorageEnabled}
                        onChange={(e) => setMediaStorageEnabled(e.target.checked)}
                        className="rounded border-ink-300 dark:border-ink-600"
                      />
                      {t("superAdmin.mediaStorageEnable")}
                    </label>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStorageDriver")}</label>
                      <select
                        value={mediaStorageDriver}
                        onChange={(e) => setMediaStorageDriver(e.target.value as "local" | "minio")}
                        disabled={!mediaStorageEnabled}
                        className="input-field mt-1 max-w-xs"
                      >
                        <option value="local">{t("superAdmin.mediaStorageDriverLocal")}</option>
                        <option value="minio">{t("superAdmin.mediaStorageDriverMinio")}</option>
                      </select>
                    </div>
                    {mediaStorageEnabled && mediaStorageDriver === "minio" ? (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStorageEndpoint")}</label>
                          <input
                            value={mediaStorageEndpoint}
                            onChange={(e) => setMediaStorageEndpoint(e.target.value)}
                            placeholder="http://minio:9000"
                            className="input-field mt-1"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStorageBucket")}</label>
                          <input
                            value={mediaStorageBucket}
                            onChange={(e) => setMediaStorageBucket(e.target.value)}
                            className="input-field mt-1"
                            required
                          />
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStorageAccessKey")}</label>
                            <input
                              type="password"
                              value={mediaStorageAccessKey}
                              onChange={(e) => setMediaStorageAccessKey(e.target.value)}
                              placeholder={mediaStorageSnapshot.accessKeyMasked || undefined}
                              className="input-field mt-1"
                              autoComplete="new-password"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStorageSecretKey")}</label>
                            <input
                              type="password"
                              value={mediaStorageSecretKey}
                              onChange={(e) => setMediaStorageSecretKey(e.target.value)}
                              placeholder={mediaStorageSnapshot.secretKeyMasked || undefined}
                              className="input-field mt-1"
                              autoComplete="new-password"
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStorageRegion")}</label>
                            <input
                              value={mediaStorageRegion}
                              onChange={(e) => setMediaStorageRegion(e.target.value)}
                              className="input-field mt-1"
                            />
                          </div>
                          <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm text-ink-800 dark:text-ink-200">
                            <input
                              type="checkbox"
                              checked={mediaStorageUseSsl}
                              onChange={(e) => setMediaStorageUseSsl(e.target.checked)}
                              className="rounded border-ink-300 dark:border-ink-600"
                            />
                            {t("superAdmin.mediaStorageUseSsl")}
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ink-600">{t("superAdmin.mediaStoragePublicBaseUrl")}</label>
                          <p className="mt-0.5 text-xs text-ink-500">{t("superAdmin.mediaStoragePublicBaseUrlHint")}</p>
                          <input
                            value={mediaStoragePublicBaseUrl}
                            onChange={(e) => setMediaStoragePublicBaseUrl(e.target.value)}
                            placeholder="https://cdn.example.com/openconduit-media"
                            className="input-field mt-2"
                          />
                        </div>
                      </>
                    ) : null}
                    <button type="submit" className="btn-primary" disabled={mediaStorageSaving}>
                      {mediaStorageSaving ? t("common.saving") : t("superAdmin.mediaStorageSave")}
                    </button>
                  </form>
                )}
              </section>
              <section className="card-surface p-6">
                <h2 className="mb-2 font-semibold text-ink-900">{t("superAdmin.turnstileTitle")}</h2>
                <p className="mb-2 text-sm text-ink-600">{t("superAdmin.turnstileSubtitle")}</p>
                <a
                  href="https://developers.cloudflare.com/turnstile/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-4 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t("superAdmin.turnstileDocLink")} →
                </a>
                {turnstileLoad ? (
                  <p className="text-sm text-ink-500">{t("common.loading")}</p>
                ) : (
                  <form onSubmit={(e) => void saveTurnstile(e)} className="space-y-4">
                    {turnstileSnapshot.configured && turnstileSnapshot.enabled ? (
                      <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
                        {t("superAdmin.turnstileConfigured")}
                      </p>
                    ) : turnstileSnapshot.enabled ? (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                        {t("superAdmin.turnstileIncomplete")}
                      </p>
                    ) : null}
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
                      <input
                        type="checkbox"
                        checked={turnstileEnabled}
                        onChange={(e) => setTurnstileEnabled(e.target.checked)}
                        className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      />
                      {t("superAdmin.turnstileEnabled")}
                    </label>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.turnstileSiteKey")}</label>
                      <input
                        value={turnstileSiteKey}
                        onChange={(e) => setTurnstileSiteKey(e.target.value)}
                        className="input-field mt-1 font-mono text-sm"
                        autoComplete="off"
                        placeholder="0x4AAAAAAA..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.turnstileSecretKey")}</label>
                      <p className="mt-0.5 text-xs text-ink-500">{t("superAdmin.turnstileSecretKeyHint")}</p>
                      <input
                        type="password"
                        value={turnstileSecretKey}
                        onChange={(e) => setTurnstileSecretKey(e.target.value)}
                        className="input-field mt-1 font-mono text-sm"
                        autoComplete="new-password"
                        placeholder={
                          turnstileSnapshot.secretKeyMasked
                            ? `•••••••• (${turnstileSnapshot.secretKeyMasked})`
                            : "0x4AAAAAAA..."
                        }
                      />
                    </div>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{t("superAdmin.turnstileScopeHint")}</p>
                    <button type="submit" className="btn-primary" disabled={turnstileSaving}>
                      {turnstileSaving ? t("common.saving") : t("superAdmin.turnstileSave")}
                    </button>
                  </form>
                )}
              </section>
              <section className="card-surface p-6">
                <h2 className="mb-2 font-semibold text-ink-900">{t("superAdmin.resendEmailTitle")}</h2>
                <p className="mb-2 text-sm text-ink-600">{t("superAdmin.resendEmailSubtitle")}</p>
                <a
                  href="https://resend.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-4 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t("superAdmin.resendDocLink")} →
                </a>
                {resendLoad ? (
                  <p className="text-sm text-ink-500">{t("common.loading")}</p>
                ) : (
                  <form onSubmit={(e) => void saveResend(e)} className="space-y-4">
                    {resendSnapshot.configured ? (
                      <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
                        {t("superAdmin.resendConfigured")}
                      </p>
                    ) : (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                        {t("superAdmin.resendIncomplete")}
                      </p>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.resendFromEmail")}</label>
                      <input
                        type="email"
                        required
                        value={resendFromEmail}
                        onChange={(e) => setResendFromEmail(e.target.value)}
                        className="input-field mt-1"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.resendFromName")}</label>
                      <input
                        value={resendFromName}
                        onChange={(e) => setResendFromName(e.target.value)}
                        className="input-field mt-1"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.resendApiKey")}</label>
                      <p className="mt-0.5 text-xs text-ink-500">{t("superAdmin.resendApiKeyHint")}</p>
                      <input
                        type="password"
                        value={resendApiKey}
                        onChange={(e) => setResendApiKey(e.target.value)}
                        placeholder={
                          resendSnapshot.apiKeyMasked
                            ? `•••••••• (${resendSnapshot.apiKeyMasked})`
                            : undefined
                        }
                        className="input-field mt-2"
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">{t("superAdmin.resendSystemLogoUrl")}</label>
                      <p className="mt-0.5 text-xs text-ink-500">{t("superAdmin.resendSystemLogoUrlHint")}</p>
                      <input
                        type="url"
                        value={resendSystemLogoUrl}
                        onChange={(e) => setResendSystemLogoUrl(e.target.value)}
                        placeholder="https://app.seudominio.com/logo.svg"
                        className="input-field mt-2 w-full"
                        autoComplete="off"
                      />
                    </div>
                    <ResendPasswordResetTemplateEditor
                      fromName={resendFromName}
                      logoUrl={resendSystemLogoUrl}
                      subject={resendPasswordResetSubject}
                      html={resendPasswordResetHtml}
                      onSubjectChange={setResendPasswordResetSubject}
                      onHtmlChange={setResendPasswordResetHtml}
                    />
                    <ResendUserInviteTemplateEditor
                      fromName={resendFromName}
                      logoUrl={resendSystemLogoUrl}
                      subject={resendUserInviteSubject}
                      html={resendUserInviteHtml}
                      onSubjectChange={setResendUserInviteSubject}
                      onHtmlChange={setResendUserInviteHtml}
                    />
                    <button type="submit" className="btn-primary" disabled={resendSaving}>
                      {resendSaving ? t("common.saving") : t("superAdmin.resendSave")}
                    </button>
                  </form>
                )}
              </section>
              <section className="card-surface p-6">
                <h2 className="mb-4 font-semibold text-ink-900">{t("superAdmin.tenantPermissions")}</h2>
                <p className="text-sm text-ink-600">{t("superAdmin.tenantPermissionsSubtitle")}</p>
              </section>
              <form onSubmit={(e) => void savePlatformSetting(e)} className="card-surface space-y-4 p-6">
                <h2 className="font-semibold text-ink-900">Definição</h2>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.settingKey")}</label>
                  <input
                    value={settingKeyInput}
                    onChange={(e) => setSettingKeyInput(e.target.value)}
                    className="input-field mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.settingValueJson")}</label>
                  <textarea
                    value={settingValueInput}
                    onChange={(e) => setSettingValueInput(e.target.value)}
                    rows={6}
                    className="input-field mt-1 font-mono text-xs"
                  />
                </div>
                <button type="submit" className="btn-primary">
                  {t("superAdmin.saveSetting")}
                </button>
              </form>
              <section className="card-surface p-6">
                <h2 className="mb-4 font-semibold text-ink-900">Registros</h2>
                {settingsLoading ? (
                  <p className="text-sm text-ink-500">{t("common.loading")}</p>
                ) : platformSettings.length === 0 ? (
                  <p className="text-sm text-ink-500">Nenhuma definição.</p>
                ) : (
                  <ul className="space-y-3">
                    {platformSettings.map((s) => (
                      <li key={s.id} className="rounded border border-ink-100 bg-ink-50 px-3 py-2 text-sm">
                        <p className="font-mono font-semibold text-ink-900">{s.key}</p>
                        <pre className="mt-1 overflow-x-auto text-xs text-ink-700">
                          {JSON.stringify(s.value, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {section === "whatsappEmbedded" && (
            <div className="mx-auto max-w-3xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-ink-900">{t("superAdmin.whatsappEmbedded")}</h1>
                <p className="mt-1 text-sm text-ink-600">{t("superAdmin.whatsappEmbeddedSubtitle")}</p>
                <a
                  href="https://developers.facebook.com/docs/whatsapp/embedded-signup/overview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  {t("superAdmin.whatsappEmbeddedDocLink")} →
                </a>
              </div>
              {waEmbLoad ? (
                <p className="text-sm text-ink-500">{t("common.loading")}</p>
              ) : waEmbLoadFailed || !waEmbSnapshot ? (
                <div className="card-surface space-y-3 p-6">
                  <p className="text-sm text-ink-700">{t("superAdmin.whatsappEmbeddedLoadError")}</p>
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => setWaEmbRefresh((n) => n + 1)}
                  >
                    {t("superAdmin.whatsappEmbeddedRetry")}
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void saveWhatsAppEmbedded(e)} className="card-surface space-y-5 p-6">
                  {waEmbSnapshot.configured ? (
                    <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                      {t("superAdmin.whatsappEmbeddedConfigured")}
                    </p>
                  ) : (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {t("superAdmin.whatsappEmbeddedIncomplete")}
                    </p>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.whatsappEmbeddedCallbackUrl")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappEmbeddedCallbackHint")}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="input-field flex-1 overflow-x-auto font-mono text-xs">
                        {waEmbSnapshot.metaWebhookCallbackUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyWaEmbCallback()}
                        className="btn-secondary shrink-0 gap-2 py-2 text-sm"
                        aria-label="Copy callback URL"
                      >
                        {waEmbCallbackCopied ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">{t("superAdmin.whatsappEmbeddedAppId")}</label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappEmbeddedAppIdHint")}</p>
                    <input
                      value={waEmbAppId}
                      onChange={(e) => setWaEmbAppId(e.target.value)}
                      className="input-field mt-2"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">{t("superAdmin.whatsappEmbeddedAppSecret")}</label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappEmbeddedAppSecretHint")}</p>
                    <input
                      type="password"
                      value={waEmbAppSecret}
                      onChange={(e) => setWaEmbAppSecret(e.target.value)}
                      placeholder={
                        waEmbSnapshot.appSecretMasked
                          ? `${t("superAdmin.whatsappEmbeddedSecretKeep")} (${waEmbSnapshot.appSecretMasked})`
                          : undefined
                      }
                      className="input-field mt-2"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.whatsappEmbeddedConfigId")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappEmbeddedConfigIdHint")}</p>
                    <input
                      value={waEmbConfigurationId}
                      onChange={(e) => setWaEmbConfigurationId(e.target.value)}
                      className="input-field mt-2"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">{t("superAdmin.whatsappEmbeddedApiVersion")}</label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappEmbeddedApiVersionHint")}</p>
                    <input
                      value={waEmbApiVersion}
                      onChange={(e) => setWaEmbApiVersion(e.target.value)}
                      placeholder="v22.0"
                      className="input-field mt-2"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.whatsappEmbeddedVerifyToken")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.whatsappEmbeddedVerifyHint")}</p>
                    <input
                      value={waEmbVerifyToken}
                      onChange={(e) => setWaEmbVerifyToken(e.target.value)}
                      className="input-field mt-2"
                      autoComplete="off"
                    />
                  </div>
                  <button type="submit" className="btn-primary" disabled={waEmbSave}>
                    {waEmbSave ? t("common.loading") : t("superAdmin.whatsappEmbeddedSave")}
                  </button>
                </form>
              )}
            </div>
          )}

          {section === "evolutionPlatform" && (
            <div className="mx-auto max-w-3xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-ink-900">{t("superAdmin.evolutionPlatform")}</h1>
                <p className="mt-1 text-sm text-ink-600">{t("superAdmin.evolutionPlatformSubtitle")}</p>
                <a
                  href="https://doc.evolution-api.com/v2/en/get-started/introduction"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  {t("superAdmin.evolutionPlatformDocLink")} →
                </a>
              </div>
              {evoPlLoad ? (
                <p className="text-sm text-ink-500">{t("common.loading")}</p>
              ) : evoPlLoadFailed || !evoPlSnapshot ? (
                <div className="card-surface space-y-3 p-6">
                  <p className="text-sm text-ink-700">{t("superAdmin.evolutionPlatformLoadError")}</p>
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => setEvoPlRefresh((n) => n + 1)}
                  >
                    {t("superAdmin.evolutionPlatformRetry")}
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void saveEvolutionPlatform(e)} className="card-surface space-y-5 p-6">
                  {evoPlSnapshot.configured ? (
                    <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                      {t("superAdmin.evolutionPlatformConfigured")}
                    </p>
                  ) : (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {t("superAdmin.evolutionPlatformIncomplete")}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-sm text-ink-800">
                    <input
                      type="checkbox"
                      checked={evoPlEnabled}
                      onChange={(e) => setEvoPlEnabled(e.target.checked)}
                      className="rounded border-ink-300"
                    />
                    {t("superAdmin.evolutionPlatformEnabled")}
                  </label>
                  <p className="text-xs text-ink-500">{t("superAdmin.evolutionPlatformEnabledHint")}</p>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.evolutionPlatformBaseUrl")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.evolutionPlatformBaseUrlHint")}</p>
                    <input
                      type="url"
                      value={evoPlBaseUrl}
                      onChange={(e) => setEvoPlBaseUrl(e.target.value)}
                      placeholder="https://evolution.example.com"
                      className="input-field mt-2"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.evolutionPlatformGlobalApiKey")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.evolutionPlatformGlobalApiKeyHint")}</p>
                    <input
                      type="password"
                      value={evoPlGlobalApiKey}
                      onChange={(e) => setEvoPlGlobalApiKey(e.target.value)}
                      placeholder={
                        evoPlSnapshot.globalApiKeyMasked
                          ? `${t("superAdmin.evolutionPlatformSecretKeep")} (${evoPlSnapshot.globalApiKeyMasked})`
                          : undefined
                      }
                      className="input-field mt-2"
                      autoComplete="new-password"
                    />
                  </div>
                  <button type="submit" className="btn-primary" disabled={evoPlSave}>
                    {evoPlSave ? t("common.loading") : t("superAdmin.evolutionPlatformSave")}
                  </button>
                </form>
              )}
            </div>
          )}

          {section === "evolutionGoPlatform" && (
            <div className="mx-auto max-w-3xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-ink-900">{t("superAdmin.evolutionGoPlatform")}</h1>
                <p className="mt-1 text-sm text-ink-600">{t("superAdmin.evolutionGoPlatformSubtitle")}</p>
                <a
                  href="https://docs.evolutionfoundation.com.br/evolution-go/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  {t("superAdmin.evolutionGoPlatformDocLink")} →
                </a>
              </div>
              {evoGoLoad ? (
                <p className="text-sm text-ink-500">{t("common.loading")}</p>
              ) : evoGoLoadFailed || !evoGoSnapshot ? (
                <div className="card-surface space-y-3 p-6">
                  <p className="text-sm text-ink-700">{t("superAdmin.evolutionGoPlatformLoadError")}</p>
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => setEvoGoRefresh((n) => n + 1)}
                  >
                    {t("superAdmin.evolutionGoPlatformRetry")}
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void saveEvolutionGoPlatform(e)} className="card-surface space-y-5 p-6">
                  {evoGoSnapshot.configured ? (
                    <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                      {t("superAdmin.evolutionGoPlatformConfigured")}
                    </p>
                  ) : (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      {t("superAdmin.evolutionGoPlatformIncomplete")}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-sm text-ink-800">
                    <input
                      type="checkbox"
                      checked={evoGoEnabled}
                      onChange={(e) => setEvoGoEnabled(e.target.checked)}
                      className="rounded border-ink-300"
                    />
                    {t("superAdmin.evolutionGoPlatformEnabled")}
                  </label>
                  <p className="text-xs text-ink-500">{t("superAdmin.evolutionGoPlatformEnabledHint")}</p>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.evolutionGoPlatformBaseUrl")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.evolutionGoPlatformBaseUrlHint")}</p>
                    <input
                      type="url"
                      value={evoGoBaseUrl}
                      onChange={(e) => setEvoGoBaseUrl(e.target.value)}
                      placeholder="https://evolution-go.example.com"
                      className="input-field mt-2"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-600">
                      {t("superAdmin.evolutionGoPlatformGlobalApiKey")}
                    </label>
                    <p className="mt-1 text-xs text-ink-500">{t("superAdmin.evolutionGoPlatformGlobalApiKeyHint")}</p>
                    <input
                      type="password"
                      value={evoGoGlobalApiKey}
                      onChange={(e) => setEvoGoGlobalApiKey(e.target.value)}
                      placeholder={
                        evoGoSnapshot.globalApiKeyMasked
                          ? `${t("superAdmin.evolutionGoPlatformSecretKeep")} (${evoGoSnapshot.globalApiKeyMasked})`
                          : undefined
                      }
                      className="input-field mt-2"
                      autoComplete="new-password"
                    />
                  </div>
                  <button type="submit" className="btn-primary" disabled={evoGoSave}>
                    {evoGoSave ? t("common.loading") : t("superAdmin.evolutionGoPlatformSave")}
                  </button>
                </form>
              )}
            </div>
          )}

          {section === "monitoring" && (
            <div className="space-y-6">
              <SuperAdminPageHeader
                title={t("superAdmin.monitoring")}
                subtitle={t("superAdmin.monitoringSubtitle")}
              />
              {monitoringLoading || !monitoring ? (
                <p className="text-sm text-gray-500">{t("common.loading")}</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <SuperAdminMetricCard
                    label={t("superAdmin.db")}
                    value={monitoring.database.ok ? "OK" : "Erro"}
                    hint={`${t("superAdmin.latency")}: ${monitoring.database.latencyMs} ms`}
                    accent={monitoring.database.ok ? "emerald" : "amber"}
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.redis")}
                    value={monitoring.redis.ok ? "OK" : "Erro"}
                    hint={`${t("superAdmin.latency")}: ${monitoring.redis.latencyMs} ms${monitoring.redis.error ? ` — ${monitoring.redis.error}` : ""}`}
                    accent={monitoring.redis.ok ? "emerald" : "amber"}
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.jobs")}
                    value={monitoring.backgroundJobs.mode}
                    hint={monitoring.backgroundJobs.note}
                    accent="violet"
                  />
                </div>
              )}
              <SuperAdminPanel className="p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">{t("superAdmin.platformApiHint")}</p>
                <code className="mt-2 block overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                  GET {window.location.origin}/api/v1/platform/me
                  <br />
                  Authorization: Bearer ocp_…
                </code>
              </SuperAdminPanel>
            </div>
          )}

          {section === "platformApps" && (
            <div className="mx-auto max-w-5xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.platformApps")}</h1>
                <p className="mt-1 text-sm text-gray-500">{t("superAdmin.platformApiHint")}</p>
              </div>
              {newToken && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-950">{t("superAdmin.tokenOnce")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-xs text-gray-800">
                      {newToken}
                    </code>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(newToken)}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="mt-3 text-xs font-medium text-amber-900 underline"
                    onClick={() => setNewToken(null)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              )}
              <form onSubmit={(e) => void handleCreatePlatformApp(e)} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 font-semibold text-gray-900">{t("superAdmin.newApp")}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600">{t("superAdmin.appName")}</label>
                    <input
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600">{t("superAdmin.appDescription")}</label>
                    <input
                      value={appDesc}
                      onChange={(e) => setAppDesc(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  {t("superAdmin.createApp")}
                </button>
              </form>
              <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 font-semibold text-gray-900">Aplicações ativas</h2>
                {platformLoading ? (
                  <p className="text-sm text-gray-500">{t("common.loading")}</p>
                ) : platformApps.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhuma aplicação.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {platformApps.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-medium text-gray-900">{a.name}</p>
                          <p className="text-xs text-gray-500">
                            {t("superAdmin.tokenPrefix")}: {a.tokenPrefix}… · {a.createdBy.email}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRevokeApp(a.id)}
                          className="text-sm font-medium text-red-600 hover:underline"
                        >
                          {t("superAdmin.revokeApp")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {section === "auditLog" && (
            <div className="space-y-6">
              <SuperAdminPageHeader
                title={t("superAdmin.auditLog")}
                subtitle={t("superAdmin.auditSubtitle")}
              />
              {auditLoading || !auditData ? (
                <p className="text-sm text-slate-500">{t("common.loading")}</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SuperAdminMetricCard
                      label={t("superAdmin.auditStatTotal")}
                      value={auditData.total}
                      accent="violet"
                    />
                    <SuperAdminMetricCard
                      label={t("superAdmin.auditStatPage")}
                      value={`${auditData.page} / ${auditData.totalPages}`}
                      accent="emerald"
                    />
                  </div>
                  <SuperAdminPanel className="overflow-x-auto p-0">
                    <table className="w-full min-w-[800px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          <th className="px-4 py-2">{t("superAdmin.when")}</th>
                          <th className="px-4 py-2">{t("superAdmin.actor")}</th>
                          <th className="px-4 py-2">{t("superAdmin.org")}</th>
                          <th className="px-4 py-2">{t("superAdmin.action")}</th>
                          <th className="px-4 py-2">{t("superAdmin.resource")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditData.data.map((row) => (
                          <tr key={row.id}>
                            <td className="whitespace-nowrap px-4 py-2 text-gray-600">
                              {new Date(row.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-gray-900">{row.actor.email}</td>
                            <td className="px-4 py-2 text-gray-600">{row.organization?.name ?? "—"}</td>
                            <td className="px-4 py-2 font-mono text-xs text-gray-800">{row.action}</td>
                            <td className="px-4 py-2 text-xs text-gray-600">
                              {row.resourceType}
                              {row.resourceId ? ` · ${row.resourceId}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </SuperAdminPanel>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-slate-600">
                      {t("superAdmin.page")} {auditData.page} / {auditData.totalPages} ({auditData.total})
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={auditPage <= 1}
                        onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {t("superAdmin.prev")}
                      </button>
                      <button
                        type="button"
                        disabled={auditPage >= auditData.totalPages}
                        onClick={() => setAuditPage((p) => p + 1)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {t("superAdmin.next")}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {section === "conversationMedia" && <SuperAdminConversationMediaSection />}

          {section === "featureFlags" && (
            <div className="mx-auto max-w-3xl space-y-6">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.featureFlags")}</h1>
                <p className="mt-1 text-sm text-gray-500">{t("superAdmin.flagsSubtitle")}</p>
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {t("superAdmin.flagsSuperAdminHint")}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">{t("superAdmin.selectOrg")}</label>
                <select
                  value={flagsOrgId}
                  onChange={(e) => setFlagsOrgId(e.target.value)}
                  className="mt-1 w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.slug})
                    </option>
                  ))}
                </select>
              </div>
              {flagsLoading || !flagsPayload ? (
                <p className="text-sm text-gray-500">{t("common.loading")}</p>
              ) : (
                <>
                  {flagsPayload.wavoipDiagnostics &&
                  flagsPayload.wavoipDiagnostics.deviceCount > 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                      <p className="font-medium">{t("superAdmin.wavoipDiagTitle")}</p>
                      <p className="mt-1 text-slate-600">
                        {t("superAdmin.wavoipDiagDevices").replace(
                          "{count}",
                          String(flagsPayload.wavoipDiagnostics.deviceCount),
                        )}
                      </p>
                      {flagsPayload.wavoipDiagnostics.lastLog ? (
                        <p className="mt-2 font-mono text-xs text-slate-600">
                          {flagsPayload.wavoipDiagnostics.lastLog.createdAt} ·{" "}
                          {flagsPayload.wavoipDiagnostics.lastLog.eventType}:{" "}
                          {flagsPayload.wavoipDiagnostics.lastLog.message.slice(0, 120)}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-amber-700">{t("superAdmin.wavoipDiagNoLogs")}</p>
                      )}
                    </div>
                  ) : null}
                  {flagsPayload.nvoipDiagnostics?.hasAccount ? (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
                      <p className="font-medium">{t("superAdmin.nvoipDiagTitle")}</p>
                      <p className="mt-1 text-violet-800">
                        {t("superAdmin.nvoipDiagAccount")
                          .replace("{status}", flagsPayload.nvoipDiagnostics.accountStatus ?? "—")
                          .replace("{numbersip}", flagsPayload.nvoipDiagnostics.numbersip ?? "—")}
                        {flagsPayload.nvoipDiagnostics.lastBalance
                          ? ` · ${flagsPayload.nvoipDiagnostics.lastBalance}`
                          : ""}
                      </p>
                      <p className="mt-1 text-violet-700">
                        {t("superAdmin.nvoipDiagCalls30d").replace(
                          "{count}",
                          String(flagsPayload.nvoipDiagnostics.callCount30d),
                        )}
                      </p>
                      {flagsPayload.nvoipDiagnostics.lastLog ? (
                        <p className="mt-2 font-mono text-xs text-violet-700">
                          {flagsPayload.nvoipDiagnostics.lastLog.createdAt} ·{" "}
                          {flagsPayload.nvoipDiagnostics.lastLog.eventType}:{" "}
                          {flagsPayload.nvoipDiagnostics.lastLog.message.slice(0, 120)}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-amber-800">{t("superAdmin.nvoipDiagNoLogs")}</p>
                      )}
                    </div>
                  ) : flagsPayload.flags.some((f) => f.key.startsWith("nvoip_") && f.enabled) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <p className="font-medium">{t("superAdmin.nvoipDiagTitle")}</p>
                      <p className="mt-1">{t("superAdmin.nvoipDiagNoAccount")}</p>
                    </div>
                  ) : null}
                <ul className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  {flagsPayload.flags.map((f) => (
                    <li
                      key={f.key}
                      className="flex items-center justify-between gap-4 border-b border-gray-100 pb-3 last:border-0 last:pb-0"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{flagTitle(f.key)}</p>
                        <p className="text-xs text-gray-500">
                          {f.key} · omissão: {f.defaultEnabled ? "on" : "off"}
                          {f.configuredInDb
                            ? ` · BD: ${f.dbEnabled ? "on" : "off"}`
                            : " · BD: —"}
                          {f.key === "wavoip_voice" &&
                          f.configuredInDb &&
                          f.dbEnabled === false &&
                          (flagsPayload.wavoipDiagnostics?.deviceCount ?? 0) > 0 ? (
                            <span className="block text-amber-700">{t("superAdmin.wavoipExplicitOff")}</span>
                          ) : null}
                          {f.key === "wavoip_voice" &&
                          !f.configuredInDb &&
                          (flagsPayload.wavoipDiagnostics?.deviceCount ?? 0) > 0 &&
                          f.enabled ? (
                            <span className="block text-emerald-700">{t("superAdmin.wavoipLegacyOn")}</span>
                          ) : null}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={flagBusy === f.key}
                        onClick={() => void toggleFlag(f.key, !f.enabled)}
                        className={clsx(
                          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                          f.enabled ? "bg-brand-500" : "bg-gray-200",
                        )}
                        aria-pressed={f.enabled}
                      >
                        <span
                          className={clsx(
                            "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                            f.enabled ? "left-6" : "left-0.5",
                          )}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
                </>
              )}
            </div>
          )}

          {section === "organizations" && (
            <div className="space-y-6">
              <SuperAdminPageHeader
                title={t("superAdmin.organizations")}
                subtitle={t("superAdmin.organizationsSubtitle")}
              />
              {stats && !loading ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <SuperAdminMetricCard
                    label={t("superAdmin.organizationsStatTotal")}
                    value={stats.organizationTotal}
                    accent="violet"
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.organizationsStatActive")}
                    value={stats.organizationActive}
                    accent="emerald"
                  />
                  <SuperAdminMetricCard
                    label={t("superAdmin.organizationsStatSuspended")}
                    value={stats.organizationSuspended}
                    accent="amber"
                  />
                </div>
              ) : null}

              <SuperAdminPanel className="p-6">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900">
                  <Building2 className="h-5 w-5" />
                  Nova organização
                </h2>
                <p className="mb-4 text-sm text-gray-500">
                  Cria um tenant isolado com pipeline, tipos de lead e etiquetas padrão. O webhook WhatsApp será{" "}
                  <code className="rounded bg-gray-100 px-1">…/webhooks/whatsapp/&lt;id&gt;</code>.
                </p>
                <form onSubmit={(e) => void handleCreate(e)} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px] flex-1">
                    <label className="block text-xs font-medium text-gray-600">Nome</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Ex.: Clínica Norte"
                      required
                    />
                  </div>
                  <div className="w-44">
                    <label className="block text-xs font-medium text-gray-600">Slug (opcional)</label>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="auto"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {submitting ? "A criar…" : "Criar"}
                  </button>
                </form>
              </SuperAdminPanel>

              <SuperAdminPanel className="p-6">
                <h2 className="mb-4 font-semibold text-slate-900">Lista de organizações</h2>
                {loading ? (
                  <p className="text-sm text-gray-500">{t("common.loading")}</p>
                ) : orgs.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhuma organização.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wide text-gray-500">
                          <th className="pb-2 pr-4">Nome</th>
                          <th className="pb-2 pr-4">Slug</th>
                          <th className="pb-2 pr-3">{t("superAdmin.planColumn")}</th>
                          <th className="pb-2 pr-3 text-right">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              Users
                            </span>
                          </th>
                          <th className="pb-2 pr-3 text-right">Contactos</th>
                          <th className="pb-2 pr-3 text-right">
                            <span className="inline-flex items-center gap-1">
                              <MessagesSquare className="h-3.5 w-3.5" />
                              Conversas
                            </span>
                          </th>
                          <th className="pb-2 pr-4">Estado</th>
                          <th className="pb-2 pr-2">Webhook</th>
                          <th className="pb-2 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {orgs.map((o) => (
                          <tr key={o.id}>
                            <td className="py-3 pr-4 font-medium text-gray-900">{o.name}</td>
                            <td className="py-3 pr-4 text-ink-600">{o.slug}</td>
                            <td className="py-3 pr-3 tabular-nums text-ink-700">{o.planTier ?? "free"}</td>
                            <td className="py-3 pr-3 text-right tabular-nums text-gray-600">
                              {o._count.users}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums text-gray-600">
                              {o._count.contacts}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums text-gray-600">
                              {o._count.conversations}
                            </td>
                            <td className="py-3 pr-4">
                              <button
                                type="button"
                                onClick={() => void toggleActive(o.id, o.isActive)}
                                className={
                                  o.isActive
                                    ? "text-sm font-medium text-green-700 hover:underline"
                                    : "text-sm font-medium text-gray-500 hover:underline"
                                }
                              >
                                {o.isActive ? "Ativa" : "Suspensa"}
                              </button>
                            </td>
                            <td className="py-3 pr-2">
                              <div className="flex items-center gap-1">
                                <code className="max-w-[140px] truncate font-mono text-xs text-gray-500">
                                  {webhookUrlFor(o.id)}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => void copyWebhook(o.id)}
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                  title="Copiar webhook"
                                >
                                  {copiedId === o.id ? (
                                    <Check className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <Copy className="h-4 w-4" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex flex-col items-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditOrg(o)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  {t("superAdmin.orgEdit")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteOrgConfirm(o)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {t("superAdmin.orgDelete")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFlagsOrgId(o.id);
                                    setSection("featureFlags");
                                  }}
                                  className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                                >
                                  {t("superAdmin.orgOpenFeatures")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openBillingModal(o)}
                                  className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                                >
                                  {t("superAdmin.editBilling")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setUsersOrg(o)}
                                  className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                                >
                                  {t("superAdmin.teamUsers")}
                                </button>
                                <button
                                  type="button"
                                  disabled={!o.isActive || enteringId === o.id}
                                  onClick={() => void onEnterOrg(o.id)}
                                  className="mt-1 inline-flex items-center gap-1.5 rounded bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <UserCircle className="h-3.5 w-3.5" />
                                  {enteringId === o.id ? "A entrar…" : "Entrar na organização"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SuperAdminPanel>
            </div>
          )}
      </SuperAdminShell>

        {billingOrg ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="card-surface max-h-[90vh] w-full max-w-md overflow-auto p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-ink-900">{t("superAdmin.billingPlan")}</h3>
              <p className="mt-1 text-sm text-ink-600">{billingOrg.name}</p>
              <form onSubmit={(e) => void submitBilling(e)} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-600">Plano</label>
                  <select
                    value={billingPlanTier}
                    onChange={(e) => setBillingPlanTier(e.target.value)}
                    className="input-field mt-1"
                  >
                    <option value="free">{t("superAdmin.planFree")}</option>
                    <option value="growth">{t("superAdmin.planGrowth")}</option>
                    <option value="enterprise">{t("superAdmin.planEnterprise")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.billingEmail")}</label>
                  <input
                    type="email"
                    value={billingEmailState}
                    onChange={(e) => setBillingEmailState(e.target.value)}
                    className="input-field mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.messageQuota")}</label>
                  <input
                    type="number"
                    min={1}
                    value={billingQuota}
                    onChange={(e) => setBillingQuota(e.target.value)}
                    className="input-field mt-1"
                    placeholder="—"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" className="btn-secondary" onClick={() => setBillingOrg(null)}>
                    {t("common.cancel")}
                  </button>
                  <button type="submit" className="btn-primary" disabled={billingSaving}>
                    {t("superAdmin.saveBilling")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {editOrg ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
            <div className="card-surface w-full max-w-md p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-ink-900">{t("superAdmin.orgEditTitle")}</h3>
              <form onSubmit={(e) => void saveEditOrg(e)} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-600">Nome</label>
                  <input value={editOrgName} onChange={(e) => setEditOrgName(e.target.value)} className="input-field mt-1" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.orgSlug")}</label>
                  <input value={editOrgSlug} onChange={(e) => setEditOrgSlug(e.target.value)} className="input-field mt-1" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-600">{t("superAdmin.planColumn")}</label>
                  <select value={editOrgPlan} onChange={(e) => setEditOrgPlan(e.target.value)} className="input-field mt-1">
                    <option value="free">{t("superAdmin.planFree")}</option>
                    <option value="growth">{t("superAdmin.planGrowth")}</option>
                    <option value="enterprise">{t("superAdmin.planEnterprise")}</option>
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={editOrgActive} onChange={(e) => setEditOrgActive(e.target.checked)} />
                  Organização ativa
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setEditOrg(null)}>{t("common.cancel")}</button>
                  <button type="submit" className="btn-primary" disabled={editOrgSaving}>
                    {editOrgSaving ? t("common.saving") : t("superAdmin.orgSave")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {deleteOrgConfirm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
            <div className="card-surface w-full max-w-md p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-red-800">{t("superAdmin.orgDeleteTitle")}</h3>
              <p className="mt-2 text-sm text-ink-600">
                {t("superAdmin.orgDeleteConfirm").replace("{name}", deleteOrgConfirm.name)}
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setDeleteOrgConfirm(null)}>{t("common.cancel")}</button>
                <button
                  type="button"
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={deleteOrgBusy}
                  onClick={() => void deleteOrganization()}
                >
                  {deleteOrgBusy ? t("common.loading") : t("superAdmin.orgDelete")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {editPlatformUser ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.target === e.currentTarget && setEditPlatformUser(null)}
          >
            <div
              className="card-surface w-full max-w-md overflow-auto p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.platformUsersEditTitle")}</h3>
              <form onSubmit={(e) => void savePlatformUser(e)} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600">{t("superAdmin.platformUsersName")}</label>
                  <input
                    type="text"
                    value={editUserName}
                    onChange={(e) => setEditUserName(e.target.value)}
                    className="input-field mt-1 w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">{t("superAdmin.platformUsersEmail")}</label>
                  <input
                    type="email"
                    value={editUserEmail}
                    onChange={(e) => setEditUserEmail(e.target.value)}
                    className="input-field mt-1 w-full"
                    required
                  />
                </div>
                <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={editUserRole === "SUPER_ADMIN"}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditUserRole("SUPER_ADMIN");
                          setEditUserOrgId("");
                        } else {
                          setEditUserRole("ADMIN");
                        }
                      }}
                      className="mt-1 rounded border-ink-300"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                        <Crown className="h-4 w-4 text-violet-700" />
                        {t("superAdmin.platformUsersGrantSuperAdmin")}
                      </span>
                      <span className="mt-1 block text-xs text-ink-600">
                        {t("superAdmin.platformUsersGrantSuperAdminHint")}
                      </span>
                    </span>
                  </label>
                </div>
                {editUserRole !== "SUPER_ADMIN" ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">
                        {t("superAdmin.platformUsersFilterRole")}
                      </label>
                      <select
                        value={editUserRole}
                        onChange={(e) => setEditUserRole(e.target.value as "ADMIN" | "AGENT")}
                        className="input-field mt-1 w-full"
                      >
                        <option value="ADMIN">{t("superAdmin.roleAdmin")}</option>
                        <option value="AGENT">{t("superAdmin.roleAgent")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-600">
                        {t("superAdmin.platformUsersAssignOrg")}
                      </label>
                      <select
                        value={editUserOrgId}
                        onChange={(e) => setEditUserOrgId(e.target.value)}
                        className="input-field mt-1 w-full"
                        required
                      >
                        <option value="">{t("superAdmin.platformUsersNoOrg")}</option>
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmUser(editPlatformUser);
                      setEditPlatformUser(null);
                    }}
                    disabled={editPlatformUser.id === user?.id || editUserSaving}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("superAdmin.platformUsersDelete")}
                  </button>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setEditPlatformUser(null)}>
                      {t("common.cancel")}
                    </button>
                    <button type="submit" className="btn-primary" disabled={editUserSaving}>
                      {editUserSaving ? t("common.loading") : t("superAdmin.platformUsersSave")}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {deleteConfirmUser ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.target === e.currentTarget && setDeleteConfirmUser(null)}
          >
            <div
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.platformUsersDeleteTitle")}</h3>
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium text-slate-900">{deleteConfirmUser.name}</span> (
                {deleteConfirmUser.email})
              </p>
              <p className="mt-3 text-sm text-slate-600">{t("superAdmin.platformUsersDeleteConfirm")}</p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setDeleteConfirmUser(null)}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={editUserDeleting}
                  onClick={() => void deletePlatformUser(deleteConfirmUser)}
                >
                  {editUserDeleting ? t("common.loading") : t("superAdmin.platformUsersDelete")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

                {usersOrg ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.target === e.currentTarget && setUsersOrg(null)}
          >
            <div
              className="card-surface max-h-[90vh] w-full max-w-lg overflow-auto p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-ink-900">{t("superAdmin.teamUsers")}</h3>
              <p className="mt-1 text-sm text-ink-600">{usersOrg.name}</p>
              {usersLoading ? (
                <p className="mt-4 text-sm text-ink-500">{t("common.loading")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-ink-100">
                  {orgUsers.map((u) => (
                    <li key={u.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{u.name}</p>
                        <p className="text-xs text-ink-600">{u.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={u.role}
                          disabled={userRoleBusy === u.id}
                          onChange={(e) =>
                            void patchOrgUserRole(u.id, e.target.value as "ADMIN" | "AGENT")
                          }
                          className="input-field w-auto py-1 text-xs"
                        >
                          <option value="ADMIN">{t("superAdmin.roleAdmin")}</option>
                          <option value="AGENT">{t("superAdmin.roleAgent")}</option>
                        </select>
                        <button
                          type="button"
                          disabled={!usersOrg.isActive || impersonateBusy === u.id}
                          onClick={() => void impersonateOrgUser(usersOrg.id, u.id)}
                          className="btn-secondary py-1.5 text-xs disabled:opacity-50"
                        >
                          {impersonateBusy === u.id ? "…" : t("superAdmin.impersonateUser")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn-secondary mt-4 w-full" onClick={() => setUsersOrg(null)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        ) : null}
    </>
  );
}