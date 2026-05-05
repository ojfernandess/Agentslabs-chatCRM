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
} from "lucide-react";
import clsx from "clsx";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
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

type SuperSection =
  | "overview"
  | "organizations"
  | "monitoring"
  | "platformApps"
  | "auditLog"
  | "featureFlags";

export function SuperAdminPage() {
  const { t } = useI18n();
  const { user, logout, enterOrganization } = useAuth();
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

  const flagTitle = (key: string) => t(`superAdmin.flag.${key}`);

  const navItem = (id: SuperSection, label: string, Icon: typeof LayoutDashboard) => (
    <button
      key={id}
      type="button"
      onClick={() => setSection(id)}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
        section === id ? "bg-brand-50 text-brand-800" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-16 items-center gap-2 border-b border-gray-100 px-4">
          <Shield className="h-7 w-7 shrink-0 text-brand-600" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500">Plataforma</p>
            <p className="truncate text-sm font-bold text-gray-900">Super admin</p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-3">
          {navItem("overview", t("superAdmin.overview"), LayoutDashboard)}
          {navItem("organizations", t("superAdmin.organizations"), Building2)}
          {navItem("monitoring", t("superAdmin.monitoring"), Activity)}
          {navItem("platformApps", t("superAdmin.platformApps"), Box)}
          {navItem("auditLog", t("superAdmin.auditLog"), ScrollText)}
          {navItem("featureFlags", t("superAdmin.featureFlags"), ToggleLeft)}
        </nav>
        <div className="mt-auto border-t border-gray-100 p-3">
          <p className="px-3 py-2 text-xs text-gray-500">OpenConduit · consola de administrador</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
          <p className="text-sm text-gray-500">{t("superAdmin.consoleSubtitle")}</p>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-600 sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-8">
          {error && (
            <p className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
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
                            <td className="py-3 pr-4 text-gray-600">{o.slug}</td>
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
                              <button
                                type="button"
                                disabled={!o.isActive || enteringId === o.id}
                                onClick={() => void onEnterOrg(o.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <UserCircle className="h-3.5 w-3.5" />
                                {enteringId === o.id ? "A entrar…" : "Entrar na organização"}
                              </button>
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
      </div>
    </div>
  );
}
