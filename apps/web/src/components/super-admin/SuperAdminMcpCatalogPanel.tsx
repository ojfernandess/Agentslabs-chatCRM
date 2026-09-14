import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  Phone,
  Plug,
  Search,
  Server,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type McpCatalogTool = {
  name: string;
  description: string;
  domain?: string;
  write?: boolean;
  conditional?: string;
};

type McpCatalogResource = {
  name: string;
  uri: string;
  description: string;
};

type McpCatalogProvider = {
  domain: string;
  description: string;
};

type McpCatalogServer = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  transport: "streamable-http" | "stdio" | "stdio-bridge";
  access: "super_admin";
  auth: string[];
  endpoint?: string;
  entrypoint?: string;
  envVars?: string[];
  tools: McpCatalogTool[];
  resources: McpCatalogResource[];
  providers: McpCatalogProvider[];
  category: "platform" | "integration" | "observability";
  accent: "violet" | "emerald" | "sky" | "amber";
  cursorConfigKey: string;
};

type McpCatalogPayload = {
  servers: McpCatalogServer[];
  endpoint: string;
};

type McpCatalogApiResponse = {
  data: McpCatalogPayload;
};

type SuperAdminMcpCatalogPanelProps = {
  onError: (message: string) => void;
};

const ACCENT: Record<McpCatalogServer["accent"], { ring: string; bg: string; text: string; badge: string }> = {
  violet: {
    ring: "ring-violet-500/20",
    bg: "bg-violet-500/10",
    text: "text-violet-700",
    badge: "bg-violet-100 text-violet-800",
  },
  emerald: {
    ring: "ring-emerald-500/20",
    bg: "bg-emerald-500/10",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-800",
  },
  sky: {
    ring: "ring-sky-500/20",
    bg: "bg-sky-500/10",
    text: "text-sky-700",
    badge: "bg-sky-100 text-sky-800",
  },
  amber: {
    ring: "ring-amber-500/20",
    bg: "bg-amber-500/10",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-800",
  },
};

const SERVER_ICON: Record<string, typeof Plug> = {
  opennexo: Sparkles,
  nvoip: Phone,
  langfuse: BookOpen,
};

const TRANSPORT_LABEL: Record<McpCatalogServer["transport"], string> = {
  "streamable-http": "HTTP (Streamable)",
  stdio: "stdio (local)",
  "stdio-bridge": "stdio → HTTP bridge",
};

function buildCursorSnippet(server: McpCatalogServer, endpoint: string): string {
  const key = server.cursorConfigKey;
  if (server.transport === "streamable-http") {
    return JSON.stringify(
      {
        mcpServers: {
          [key]: {
            url: endpoint,
            headers: { Authorization: "Bearer ocm_YOUR_TOKEN" },
          },
        },
      },
      null,
      2,
    );
  }
  const entry = server.entrypoint?.split("·")[0]?.trim() ?? `apps/api/src/mcp-${key}-stdio.ts`;
  return JSON.stringify(
    {
      mcpServers: {
        [key]: {
          command: "npx",
          args: ["tsx", entry],
        },
      },
    },
    null,
    2,
  );
}

export function SuperAdminMcpCatalogPanel({ onError }: SuperAdminMcpCatalogPanelProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<McpCatalogPayload | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | McpCatalogServer["category"]>("all");
  const [expandedId, setExpandedId] = useState<string | null>("opennexo");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<McpCatalogApiResponse>("/super/mcp/catalog");
      setCatalog(res.data);
    } catch {
      onError(t("superAdmin.mcp.catalogLoadError"));
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog.servers.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      const haystack = [
        s.name,
        s.tagline,
        s.description,
        ...s.tools.map((t) => `${t.name} ${t.description}`),
        ...s.providers.map((p) => p.domain),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog, query, category]);

  const stats = useMemo(() => {
    if (!catalog) return { servers: 0, tools: 0, resources: 0, providers: 0 };
    return {
      servers: catalog.servers.length,
      tools: catalog.servers.reduce((n, s) => n + s.tools.length, 0),
      resources: catalog.servers.reduce((n, s) => n + s.resources.length, 0),
      providers: new Set(catalog.servers.flatMap((s) => s.providers.map((p) => p.domain))).size,
    };
  }, [catalog]);

  const handleCopy = async (server: McpCatalogServer) => {
    const snippet = buildCursorSnippet(server, catalog?.endpoint ?? "");
    await navigator.clipboard.writeText(snippet);
    setCopiedId(server.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (!catalog) {
    return <p className="text-sm text-slate-500">{t("superAdmin.mcp.catalogLoadError")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            { label: t("superAdmin.mcp.catalogStatServers"), value: stats.servers, icon: Server },
            { label: t("superAdmin.mcp.catalogStatTools"), value: stats.tools, icon: Wrench },
            { label: t("superAdmin.mcp.catalogStatResources"), value: stats.resources, icon: Layers },
            { label: t("superAdmin.mcp.catalogStatProviders"), value: stats.providers, icon: Plug },
          ] as const
        ).map(({ label, value, icon: Icon }) => (
          <SuperAdminPanel key={label} className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                <Icon className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
              </div>
            </div>
          </SuperAdminPanel>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("superAdmin.mcp.catalogSearch")}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "platform", "integration", "observability"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setCategory(id)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-xs font-medium",
                category === id
                  ? "bg-brand-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {t(`superAdmin.mcp.catalogCategory_${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <SuperAdminPanel className="p-8 text-center text-sm text-slate-500">
            {t("superAdmin.mcp.catalogEmpty")}
          </SuperAdminPanel>
        ) : (
          filtered.map((server) => {
            const accent = ACCENT[server.accent];
            const Icon = SERVER_ICON[server.id] ?? Plug;
            const expanded = expandedId === server.id;

            return (
              <SuperAdminPanel key={server.id} className="overflow-hidden p-0">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : server.id)}
                  className="flex w-full items-start gap-4 p-5 text-left hover:bg-slate-50/80"
                >
                  <div
                    className={clsx(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1",
                      accent.bg,
                      accent.ring,
                    )}
                  >
                    <Icon className={clsx("h-6 w-6", accent.text)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{server.name}</h3>
                      <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", accent.badge)}>
                        {t(`superAdmin.mcp.catalogCategory_${server.category}`)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {TRANSPORT_LABEL[server.transport]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-slate-600">{server.tagline}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-500">{server.description}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>{server.tools.length} {t("superAdmin.mcp.catalogTools")}</span>
                      <span>{server.resources.length} {t("superAdmin.mcp.catalogResources")}</span>
                      <span>{server.providers.length} {t("superAdmin.mcp.catalogProviders")}</span>
                    </div>
                  </div>
                  {expanded ? (
                    <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                  )}
                </button>

                {expanded ? (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-5">
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="space-y-4">
                        <section>
                          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <Terminal className="h-3.5 w-3.5" />
                            {t("superAdmin.mcp.catalogConnection")}
                          </h4>
                          <dl className="mt-2 space-y-2 text-sm">
                            {server.endpoint ? (
                              <div>
                                <dt className="text-xs text-slate-500">{t("superAdmin.mcp.endpoint")}</dt>
                                <dd className="mt-0.5 break-all font-mono text-xs text-slate-800">{server.endpoint}</dd>
                              </div>
                            ) : null}
                            {server.entrypoint ? (
                              <div>
                                <dt className="text-xs text-slate-500">{t("superAdmin.mcp.catalogEntrypoint")}</dt>
                                <dd className="mt-0.5 font-mono text-xs text-slate-800">{server.entrypoint}</dd>
                              </div>
                            ) : null}
                            {server.envVars?.length ? (
                              <div>
                                <dt className="text-xs text-slate-500">{t("superAdmin.mcp.catalogEnvVars")}</dt>
                                <dd className="mt-1 flex flex-wrap gap-1">
                                  {server.envVars.map((v) => (
                                    <code key={v} className="rounded bg-white px-1.5 py-0.5 text-[11px] ring-1 ring-slate-200">
                                      {v}
                                    </code>
                                  ))}
                                </dd>
                              </div>
                            ) : null}
                            <div>
                              <dt className="text-xs text-slate-500">{t("superAdmin.mcp.catalogAuth")}</dt>
                              <dd className="mt-1 space-y-1">
                                {server.auth.map((a) => (
                                  <p key={a} className="text-xs text-slate-700">
                                    {a}
                                  </p>
                                ))}
                              </dd>
                            </div>
                          </dl>
                        </section>

                        {server.resources.length > 0 ? (
                          <section>
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {t("superAdmin.mcp.catalogResources")} ({server.resources.length})
                            </h4>
                            <ul className="mt-2 space-y-2">
                              {server.resources.map((r) => (
                                <li key={r.uri} className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="font-mono text-xs font-medium text-slate-800">{r.uri}</p>
                                  <p className="mt-1 text-xs text-slate-500">{r.description}</p>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}
                      </div>

                      <div className="space-y-4">
                        <section>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("superAdmin.mcp.catalogTools")} ({server.tools.length})
                          </h4>
                          <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                            {server.tools.map((tool) => (
                              <li
                                key={tool.name}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <code className="text-xs font-semibold text-slate-800">{tool.name}</code>
                                  {tool.domain ? (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                                      {tool.domain}
                                    </span>
                                  ) : null}
                                  {tool.write ? (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                      write
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{tool.description}</p>
                                {tool.conditional ? (
                                  <p className="mt-1 text-[10px] italic text-slate-400">{tool.conditional}</p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </section>

                        <section>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("superAdmin.mcp.catalogProviders")} ({server.providers.length})
                          </h4>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {server.providers.map((p) => (
                              <span
                                key={p.domain}
                                title={p.description}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                              >
                                {p.domain}
                              </span>
                            ))}
                          </div>
                        </section>
                      </div>
                    </div>

                    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-900 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-slate-300">{t("superAdmin.mcp.catalogCursorConfig")}</p>
                        <button
                          type="button"
                          onClick={() => void handleCopy(server)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedId === server.id ? t("superAdmin.mcp.catalogCopied") : t("superAdmin.mcp.catalogCopyConfig")}
                        </button>
                      </div>
                      <pre className="overflow-x-auto text-[11px] leading-relaxed text-slate-100">
                        {buildCursorSnippet(server, catalog.endpoint)}
                      </pre>
                    </div>

                    <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                      <ExternalLink className="h-3.5 w-3.5" />
                      <a
                        href="https://modelcontextprotocol.io/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-slate-700"
                      >
                        Model Context Protocol
                      </a>
                    </p>
                  </div>
                ) : null}
              </SuperAdminPanel>
            );
          })
        )}
      </div>
    </div>
  );
}
