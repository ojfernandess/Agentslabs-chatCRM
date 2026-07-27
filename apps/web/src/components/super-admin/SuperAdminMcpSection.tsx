import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Plug, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPageHeader, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type OrgOption = { id: string; name: string; slug: string };

type McpTokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  role: string;
  debugMode: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
  user: { id: string; email: string; name: string } | null;
};

type McpTokensResponse = {
  data: McpTokenRow[];
  endpoint: string;
};

type SuperAdminMcpSectionProps = {
  organizations: OrgOption[];
  onError: (message: string) => void;
};

export function SuperAdminMcpSection({ organizations, onError }: SuperAdminMcpSectionProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [debugMode, setDebugMode] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<McpTokensResponse>("/super/mcp/tokens");
      setTokens(res.data);
      setEndpoint(res.endpoint);
    } catch {
      setTokens([]);
      onError(t("superAdmin.mcp.loadError"));
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  useEffect(() => {
    if (!organizationId && organizations.length > 0) {
      setOrganizationId(organizations[0]!.id);
    }
  }, [organizationId, organizations]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !organizationId) return;
    setSubmitting(true);
    onError("");
    try {
      const res = await api.post<{ data: { token: string; endpoint: string } }>("/super/mcp/tokens", {
        name: name.trim(),
        organizationId,
        debugMode,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setNewToken(res.data.token);
      setEndpoint(res.data.endpoint);
      setName("");
      await fetchTokens();
    } catch {
      onError(t("superAdmin.mcp.createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm(t("superAdmin.mcp.revokeConfirm"))) return;
    try {
      await api.delete(`/super/mcp/tokens/${id}`);
      await fetchTokens();
    } catch {
      onError(t("superAdmin.mcp.revokeError"));
    }
  };

  const cursorConfig = newToken
    ? JSON.stringify(
        {
          mcpServers: {
            opennexo: {
              url: endpoint || `${window.location.origin}/api/v1/super/mcp`,
              headers: { Authorization: `Bearer ${newToken}` },
            },
          },
        },
        null,
        2,
      )
    : "";

  return (
    <div className="space-y-8">
      <SuperAdminPageHeader
        title={t("superAdmin.mcp.title")}
        subtitle={t("superAdmin.mcp.subtitle")}
      />

      <SuperAdminPanel className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 ring-1 ring-violet-500/20">
            <Plug className="h-5 w-5 text-violet-600" />
          </div>
          <div className="min-w-0 text-sm text-slate-600">
            <p>{t("superAdmin.mcp.hint")}</p>
            {endpoint ? (
              <p className="mt-2 font-mono text-xs text-slate-800">
                {t("superAdmin.mcp.endpoint")}: {endpoint}
              </p>
            ) : null}
          </div>
        </div>
      </SuperAdminPanel>

      {newToken ? (
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
          <pre className="mt-4 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{cursorConfig}</pre>
          <button
            type="button"
            className="mt-3 text-xs font-medium text-amber-900 underline"
            onClick={() => setNewToken(null)}
          >
            {t("common.close")}
          </button>
        </div>
      ) : null}

      <form onSubmit={(e) => void handleCreate(e)} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-gray-900">{t("superAdmin.mcp.newToken")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600">{t("superAdmin.mcp.tokenName")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Cursor — Tenant Acme"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600">{t("superAdmin.mcp.organization")}</label>
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              required
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.slug})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">{t("superAdmin.mcp.expiresDays")}</label>
            <input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
                className="rounded border-gray-300"
              />
              {t("superAdmin.mcp.debugMode")}
            </label>
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting || !organizationId}
          className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {submitting ? t("common.loading") : t("superAdmin.mcp.createToken")}
        </button>
      </form>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-gray-900">{t("superAdmin.mcp.activeTokens")}</h2>
        {loading ? (
          <p className="text-sm text-gray-500">{t("common.loading")}</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-gray-500">{t("superAdmin.mcp.noTokens")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tokens.map((tok) => (
              <li key={tok.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{tok.name}</p>
                  <p className="text-xs text-gray-500">
                    {tok.organization.name} · {t("superAdmin.tokenPrefix")}: {tok.tokenPrefix}…
                    {tok.debugMode ? ` · ${t("superAdmin.mcp.debugMode")}` : ""}
                  </p>
                  <p className="text-xs text-gray-400">
                    {tok.user?.email ?? "—"}
                    {tok.lastUsedAt ? ` · ${t("superAdmin.mcp.lastUsed")}: ${new Date(tok.lastUsedAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(tok.id)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("superAdmin.revokeApp")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
