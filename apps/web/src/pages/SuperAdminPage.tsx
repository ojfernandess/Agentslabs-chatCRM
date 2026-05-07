import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Building2,
  Copy,
  Check,
  LayoutDashboard,
  LogOut,
  Shield,
  Users,
  MessagesSquare,
  UserCircle,
  Activity,
  Box,
  ScrollText,
  ToggleLeft,
  BarChart3,
  Settings2,
  MessageCircle,
  QrCode,
} from "lucide-react";
import clsx from "clsx";

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
  enabled: boolean;
  defaultEnabled: boolean;
}

interface FeatureFlagsPayload {
  organizationId: string;
  organizationName: string;
  flags: FeatureFlagRow[];
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

type SuperSection =
  | "overview"
  | "usageMetrics"
  | "organizations"
  | "globalSettings"
  | "whatsappEmbedded"
  | "evolutionPlatform"
  | "monitoring"
  | "platformApps"
  | "auditLog"
  | "featureFlags";

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
  const [usageLoading, setUsageLoading] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingRow[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingKeyInput, setSettingKeyInput] = useState("maintenance_mode");
  const [settingValueInput, setSettingValueInput] = useState('{"enabled":false}');
  const [billingOrg, setBillingOrg] = useState<OrgRow | null>(null);
  const [billingPlanTier, setBillingPlanTier] = useState("free");
  const [billingEmailState, setBillingEmailState] = useState("");
  const [billingQuota, setBillingQuota] = useState("");
  const [billingSaving, setBillingSaving] = useState(false);
  const [usersOrg, setUsersOrg] = useState<OrgRow | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userRoleBusy, setUserRoleBusy] = useState<string | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState<string | null>(null);

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

  useEffect(() => {
    if (section === "usageMetrics") void fetchUsageMetrics();
  }, [section, fetchUsageMetrics]);

  useEffect(() => {
    if (section === "globalSettings") void fetchPlatformSettingsList();
  }, [section, fetchPlatformSettingsList]);

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

  const navItem = (id: SuperSection, label: string, Icon: typeof LayoutDashboard) => (
    <button
      key={id}
      type="button"
      onClick={() => setSection(id)}
      className={clsx(
        "flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm font-medium transition-colors",
        section === id
          ? "bg-brand-50 font-semibold text-brand-700"
          : "text-ink-600 hover:bg-ink-50 hover:text-ink-900 active:bg-ink-100",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen bg-ink-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-200 bg-white">
        <div className="flex h-16 items-center gap-2 border-b border-ink-100 px-4">
          <Shield className="h-7 w-7 shrink-0 text-brand-600" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-500">Plataforma</p>
            <p className="truncate text-sm font-bold text-ink-900">Super admin</p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-3">
          {navItem("overview", t("superAdmin.overview"), LayoutDashboard)}
          {navItem("usageMetrics", t("superAdmin.usageMetrics"), BarChart3)}
          {navItem("organizations", t("superAdmin.organizations"), Building2)}
          {navItem("globalSettings", t("superAdmin.globalSettings"), Settings2)}
          {navItem("whatsappEmbedded", t("superAdmin.whatsappEmbedded"), MessageCircle)}
          {navItem("evolutionPlatform", t("superAdmin.evolutionPlatform"), QrCode)}
          {navItem("monitoring", t("superAdmin.monitoring"), Activity)}
          {navItem("platformApps", t("superAdmin.platformApps"), Box)}
          {navItem("auditLog", t("superAdmin.auditLog"), ScrollText)}
          {navItem("featureFlags", t("superAdmin.featureFlags"), ToggleLeft)}
        </nav>
        <div className="mt-auto border-t border-ink-100 p-3">
          <p className="px-3 py-2 text-xs text-ink-500">OpenConduit · consola de administrador</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink-200 bg-white px-6">
          <p className="text-sm text-ink-600">{t("superAdmin.consoleSubtitle")}</p>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-600 sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-secondary gap-2 py-2 text-sm"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-8">
          {error && (
            <p className="card-surface mb-6 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          {section === "overview" && (
            <div className="mx-auto max-w-5xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.overview")}</h1>
                <p className="mt-1 text-sm text-gray-500">{t("superAdmin.overviewSubtitle")}</p>
              </div>
              {loading || !stats ? (
                <p className="text-sm text-gray-500">{t("common.loading")}</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Organizações</p>
                    <p className="mt-2 text-3xl font-bold text-gray-900">{stats.organizationTotal}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {stats.organizationActive} ativas · {stats.organizationSuspended} suspensas
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Utilizadores</p>
                    <p className="mt-2 text-3xl font-bold text-gray-900">{stats.userTotal}</p>
                    <p className="mt-1 text-sm text-gray-600">Admins e agentes (todos os tenants)</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Contactos</p>
                    <p className="mt-2 text-3xl font-bold text-gray-900">{stats.contactTotal}</p>
                    <p className="mt-1 text-sm text-gray-600">Todos os tenants</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:col-span-2 lg:col-span-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Conversas abertas</p>
                    <p className="mt-2 text-3xl font-bold text-gray-900">
                      {stats.conversationOpen === null ? "—" : stats.conversationOpen}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {stats.conversationOpen === null
                        ? t("superAdmin.openConversationsHint")
                        : t("superAdmin.openConversationsOk")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {section === "usageMetrics" && (
            <div className="mx-auto max-w-6xl space-y-6">
              <div>
                <h1 className="text-xl font-bold text-ink-900">{t("superAdmin.usageMetrics")}</h1>
                <p className="mt-1 text-sm text-ink-600">{t("superAdmin.usageMetricsSubtitle")}</p>
              </div>
              {usageLoading || !usageMetrics ? (
                <p className="text-sm text-ink-500">{t("common.loading")}</p>
              ) : (
                <div className="overflow-x-auto card-surface">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-100 bg-ink-50 text-xs font-semibold uppercase text-ink-600">
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
                </div>
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
                <h2 className="mb-4 font-semibold text-ink-900">Registos</h2>
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

          {section === "monitoring" && (
            <div className="mx-auto max-w-5xl space-y-6">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.monitoring")}</h1>
                <p className="mt-1 text-sm text-gray-500">{t("superAdmin.monitoringSubtitle")}</p>
              </div>
              {monitoringLoading || !monitoring ? (
                <p className="text-sm text-gray-500">{t("common.loading")}</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-medium uppercase text-gray-500">{t("superAdmin.db")}</p>
                    <p className={clsx("mt-2 text-lg font-semibold", monitoring.database.ok ? "text-green-700" : "text-red-600")}>
                      {monitoring.database.ok ? "OK" : "Erro"}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {t("superAdmin.latency")}: {monitoring.database.latencyMs} ms
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-medium uppercase text-gray-500">{t("superAdmin.redis")}</p>
                    <p className={clsx("mt-2 text-lg font-semibold", monitoring.redis.ok ? "text-green-700" : "text-red-600")}>
                      {monitoring.redis.ok ? "OK" : "Erro"}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {t("superAdmin.latency")}: {monitoring.redis.latencyMs} ms
                      {monitoring.redis.error ? ` — ${monitoring.redis.error}` : ""}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:col-span-1">
                    <p className="text-xs font-medium uppercase text-gray-500">{t("superAdmin.jobs")}</p>
                    <p className="mt-2 text-sm font-medium text-gray-900">{monitoring.backgroundJobs.mode}</p>
                    <p className="mt-1 text-sm text-gray-600">{monitoring.backgroundJobs.note}</p>
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{t("superAdmin.platformApiHint")}</p>
                <code className="mt-2 block overflow-x-auto rounded bg-white px-3 py-2 text-xs">
                  GET {window.location.origin}/api/v1/platform/me
                  <br />
                  Authorization: Bearer ocp_…
                </code>
              </div>
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
            <div className="mx-auto max-w-6xl space-y-6">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.auditLog")}</h1>
                <p className="mt-1 text-sm text-gray-500">{t("superAdmin.auditSubtitle")}</p>
              </div>
              {auditLoading || !auditData ? (
                <p className="text-sm text-gray-500">{t("common.loading")}</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                    <table className="w-full min-w-[800px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase text-gray-500">
                          <th className="px-4 py-2">{t("superAdmin.when")}</th>
                          <th className="px-4 py-2">{t("superAdmin.actor")}</th>
                          <th className="px-4 py-2">{t("superAdmin.org")}</th>
                          <th className="px-4 py-2">{t("superAdmin.action")}</th>
                          <th className="px-4 py-2">{t("superAdmin.resource")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
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
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-gray-600">
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

          {section === "featureFlags" && (
            <div className="mx-auto max-w-3xl space-y-6">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.featureFlags")}</h1>
                <p className="mt-1 text-sm text-gray-500">{t("superAdmin.flagsSubtitle")}</p>
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
              )}
            </div>
          )}

          {section === "organizations" && (
            <div className="mx-auto max-w-5xl space-y-8">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.organizations")}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Crie tenants, copie o webhook, suspenda contas ou entre no painel como essa organização.
                </p>
              </div>

              <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
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
              </section>

              <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 font-semibold text-gray-900">Lista de organizações</h2>
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
              </section>
            </div>
          )}
        </main>

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
      </div>
    </div>
  );
}
