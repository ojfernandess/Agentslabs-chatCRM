import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { translate } from "@/i18n/messages";

const DOC_LOCALE = "pt-BR" as const;

type PublicDocsPayload = {
  schemaVersion: number;
  generatedAt: string;
  noticeEn: string;
  noticePt: string;
  groups: {
    id: string;
    titleEn: string;
    titlePt: string;
    endpoints: {
      method: string;
      path: string;
      auth: string;
      descriptionEn: string;
      descriptionPt: string;
      examplePayloadPt?: string;
    }[];
  }[];
};

const tDoc = (path: string) => translate(DOC_LOCALE, path);
type PublicEndpoint = PublicDocsPayload["groups"][number]["endpoints"][number];

/** Estilo tipo OpenAPI / documentação moderna: cor por verbo. */
const METHOD_ACCENTS: Record<string, { bar: string; pill: string }> = {
  GET: {
    bar: "border-l-emerald-500",
    pill:
      "bg-emerald-500/[0.12] text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  },
  POST: {
    bar: "border-l-sky-500",
    pill:
      "bg-sky-500/[0.14] text-sky-900 ring-1 ring-inset ring-sky-600/25 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/30",
  },
  PUT: {
    bar: "border-l-amber-500",
    pill:
      "bg-amber-500/[0.14] text-amber-900 ring-1 ring-inset ring-amber-600/25 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30",
  },
  PATCH: {
    bar: "border-l-violet-500",
    pill:
      "bg-violet-500/[0.14] text-violet-900 ring-1 ring-inset ring-violet-600/25 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-400/30",
  },
  DELETE: {
    bar: "border-l-rose-500",
    pill:
      "bg-rose-500/[0.14] text-rose-900 ring-1 ring-inset ring-rose-600/25 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/30",
  },
  OPTIONS: {
    bar: "border-l-slate-400",
    pill:
      "bg-slate-500/[0.12] text-slate-800 ring-1 ring-inset ring-slate-600/20 dark:bg-slate-400/10 dark:text-slate-200 dark:ring-slate-400/25",
  },
  HEAD: {
    bar: "border-l-teal-500",
    pill:
      "bg-teal-500/[0.12] text-teal-900 ring-1 ring-inset ring-teal-600/20 dark:bg-teal-400/10 dark:text-teal-200 dark:ring-teal-400/25",
  },
  WS: {
    bar: "border-l-cyan-500",
    pill:
      "bg-cyan-500/[0.14] text-cyan-900 ring-1 ring-inset ring-cyan-600/25 dark:bg-cyan-400/10 dark:text-cyan-200 dark:ring-cyan-400/30",
  },
};

const METHOD_FALLBACK = {
  bar: "border-l-brand-500",
  pill:
    "bg-brand-500/10 text-brand-800 ring-1 ring-inset ring-brand-500/25 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/30",
};

function parseMethods(methodField: string): string[] {
  return methodField
    .split("|")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function accentForMethods(methods: string[]) {
  const first = methods[0];
  return (first && METHOD_ACCENTS[first]) || METHOD_FALLBACK;
}

function authPillLabel(authKey: string, t: (path: string) => string): string {
  const full = `publicDocs.auth.${authKey}`;
  const label = t(full);
  return label === full ? authKey.replace(/_/g, " ") : label;
}

function MethodPills({ methods }: { methods: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {methods.map((m) => {
        const { pill } = METHOD_ACCENTS[m] ?? METHOD_FALLBACK;
        return (
          <span
            key={m}
            className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide ${pill}`}
          >
            {m}
          </span>
        );
      })}
    </div>
  );
}

function findEndpoint(groups: PublicDocsPayload["groups"], path: string): PublicEndpoint | null {
  for (const g of groups) {
    const hit = g.endpoints.find((e) => e.path === path);
    if (hit) return hit;
  }
  return null;
}

function isAuthEndpointForBotAutomation(e: PublicEndpoint): boolean {
  return e.path === "/api/v1/auth/login" || e.path === "/api/v1/auth/me/access-token";
}

function isTenantEndpointForBotAutomation(e: PublicEndpoint): boolean {
  const p = e.path;
  if (p.startsWith("/api/v1/automations")) return true;
  if (p.startsWith("/api/v1/bots")) return true;
  return (
    p === "/api/v1/conversations" ||
    p === "/api/v1/conversations/:id" ||
    p === "/api/v1/messages" ||
    p === "/api/v1/messages/upload-audio" ||
    p === "/api/v1/messages/upload-media" ||
    p === "/api/v1/tags" ||
    p === "/api/v1/tags/:id" ||
    p === "/api/v1/teams" ||
    p === "/api/v1/inboxes" ||
    p === "/api/v1/pipeline/board" ||
    p === "/api/v1/pipeline/stages" ||
    p === "/api/v1/pipeline/stages/:id" ||
    p === "/api/v1/lead-types" ||
    p === "/api/v1/lead-types/:id" ||
    p === "/api/v1/contacts/:id/stage"
  );
}

function buildBotAutomationGroups(data: PublicDocsPayload): PublicDocsPayload["groups"] {
  const auth = data.groups.find((g) => g.id === "auth");
  const tenant = data.groups.find((g) => g.id === "tenant_api");
  const agentBot = data.groups.find((g) => g.id === "agent_bot");
  const out: PublicDocsPayload["groups"] = [];
  if (auth) {
    const endpoints = auth.endpoints.filter(isAuthEndpointForBotAutomation);
    if (endpoints.length)
      out.push({
        ...auth,
        id: "auth_automation",
        titlePt: "Login e token de perfil (integrações)",
        endpoints,
      });
  }
  if (agentBot?.endpoints.length) {
    out.push(agentBot);
  }
  if (tenant) {
    const endpoints = tenant.endpoints.filter(isTenantEndpointForBotAutomation);
    if (endpoints.length)
      out.push({
        ...tenant,
        id: "tenant_automation",
        titlePt: "Tickets, gestão de bots, automação e funil CRM",
        endpoints,
      });
  }
  return out;
}

function DocsEndpointGroupSection({ g }: { g: PublicDocsPayload["groups"][number] }) {
  return (
    <section
      id={`group-${g.id}`}
      className="overflow-hidden rounded-lg border border-ink-200/90 bg-white shadow-md dark:border-ink-700/90 dark:bg-ink-900/80 dark:shadow-none"
    >
      <div className="border-b border-ink-200 bg-gradient-to-r from-ink-50 to-white px-5 py-4 dark:border-ink-700 dark:from-ink-900 dark:to-ink-900/50">
        <h2 className="text-base font-bold tracking-tight text-ink-900 dark:text-white">{g.titlePt}</h2>
        <p className="mt-0.5 text-xs font-medium text-ink-500 dark:text-ink-500">
          {g.endpoints.length} {g.endpoints.length === 1 ? "rota" : "rotas"}
        </p>
      </div>

      <ul className="divide-y divide-ink-100 dark:divide-ink-800/80">
        {g.endpoints.map((row, idx) => {
          const methods = parseMethods(row.method);
          const { bar } = accentForMethods(methods);
          return (
            <li key={`${g.id}-${idx}-${row.path}`} className={`border-l-4 ${bar} bg-ink-50/20 dark:bg-ink-950/20`}>
              <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <MethodPills methods={methods} />
                      <span
                        className="rounded-full bg-ink-200/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-700 dark:bg-ink-800 dark:text-ink-400"
                        title={tDoc("publicDocs.authHeading")}
                      >
                        {authPillLabel(row.auth, tDoc)}
                      </span>
                    </div>
                    <code className="block break-all font-mono text-[13px] font-medium leading-snug text-ink-900 dark:text-ink-100">
                      {row.path}
                    </code>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-300">{row.descriptionPt}</p>
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:text-ink-500">
                      {tDoc("publicDocs.colExample")}
                    </span>
                    <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden />
                  </div>
                  <pre className="max-h-80 overflow-auto rounded-md border border-ink-200/80 bg-ink-900/[0.03] p-3 font-mono text-[11px] leading-relaxed text-ink-800 dark:border-ink-700 dark:bg-black/25 dark:text-ink-300">
                    {row.examplePayloadPt?.trim() ? row.examplePayloadPt : "—"}
                  </pre>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PublicApiDocsPage() {
  const [data, setData] = useState<PublicDocsPayload | null>(null);
  const [phase404, setPhase404] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [navMode, setNavMode] = useState<"bot_automation" | "full">("bot_automation");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPhase404(false);
    void fetch("/api/v1/public/system-documentation")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setPhase404(true);
          setData(null);
          return;
        }
        if (!res.ok) {
          setError(tDoc("publicDocs.loadError"));
          setData(null);
          return;
        }
        const json = (await res.json()) as PublicDocsPayload;
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(tDoc("publicDocs.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const quickEndpoints = data
    ? {
        tokenGenerate: findEndpoint(data.groups, "/api/v1/auth/me/access-token"),
        ticketTags: findEndpoint(data.groups, "/api/v1/automations/conversations/:id/tags"),
        automationTeams: findEndpoint(data.groups, "/api/v1/automations/teams"),
        ticketTeam: findEndpoint(data.groups, "/api/v1/automations/conversations/:id/team"),
        agentBotTeams: findEndpoint(data.groups, "/api/v1/agent-bot/teams"),
        agentBotConvTeam: findEndpoint(data.groups, "/api/v1/agent-bot/conversations/:id/team"),
        crmBoard: findEndpoint(data.groups, "/api/v1/pipeline/board"),
        crmLeadTypes: findEndpoint(data.groups, "/api/v1/lead-types"),
      }
    : null;

  const botAutomationGroups = useMemo(() => (data ? buildBotAutomationGroups(data) : []), [data]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-ink-100/90 via-ink-50 to-ink-50 text-ink-900 dark:from-ink-950 dark:via-ink-950 dark:to-[#0d1218] dark:text-ink-100">
      <header className="sticky top-0 z-10 border-b border-ink-200/80 bg-white/80 shadow-sm backdrop-blur-md dark:border-ink-800/80 dark:bg-ink-900/75">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-white">{tDoc("publicDocs.title")}</h1>
              {data ? (
                <span className="rounded-full bg-ink-200/80 px-2 py-0.5 font-mono text-[10px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-400">
                  v{data.schemaVersion}
                </span>
              ) : null}
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-600 dark:text-ink-400">{tDoc("publicDocs.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/v1/public/system-documentation"
              className="btn-secondary text-sm shadow-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              {tDoc("publicDocs.jsonLink")}
            </a>
            <Link to="/login" className="btn-ghost text-sm font-semibold">
              {tDoc("login.submit")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 pb-16">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
            <span
              className="inline-block size-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
              aria-hidden
            />
            {tDoc("common.loading")}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        ) : phase404 ? (
          <div className="card-surface p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{tDoc("publicDocs.disabledTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{tDoc("publicDocs.disabledBody")}</p>
          </div>
        ) : data ? (
          <div className="animate-fade-in">
            <div className="space-y-4">
              <p className="rounded-lg border border-ink-200/80 bg-white/60 px-4 py-3 text-sm leading-relaxed text-ink-700 shadow-sm dark:border-ink-700/80 dark:bg-ink-900/40 dark:text-ink-300">
                {data.noticePt}
              </p>
              <div className="rounded-lg border border-brand-200/70 bg-gradient-to-br from-brand-50/90 to-white px-4 py-4 shadow-sm dark:border-brand-900/40 dark:from-brand-950/30 dark:to-ink-900/60">
                <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.authLegendTitle")}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-300">
                  {tDoc("publicDocs.authLegendBody")}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-ink-500 dark:text-ink-500">
                  {tDoc("publicDocs.generatedAt")}:{" "}
                  <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString("pt-BR")}</time>
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-ink-500">
                  <span className="mr-1 text-ink-400">Métodos</span>
                  {(["GET", "POST", "PUT", "PATCH", "DELETE", "WS"] as const).map((m) => {
                    const { pill } = METHOD_ACCENTS[m] ?? METHOD_FALLBACK;
                    return (
                      <span key={m} className={`rounded px-1.5 py-0.5 font-mono ${pill}`}>
                        {m}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-[260px,minmax(0,1fr)]">
              <aside className="h-fit rounded-lg border border-ink-200/90 bg-white p-4 shadow-sm dark:border-ink-700/90 dark:bg-ink-900/80">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Navegação</p>
                <div className="mb-3 flex rounded-lg border border-ink-200/90 p-0.5 dark:border-ink-700">
                  <button
                    type="button"
                    onClick={() => setNavMode("bot_automation")}
                    className={`flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold leading-tight transition-colors ${
                      navMode === "bot_automation"
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
                    }`}
                  >
                    Bot &amp; automação
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavMode("full")}
                    className={`flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold leading-tight transition-colors ${
                      navMode === "full"
                        ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600"
                        : "text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
                    }`}
                  >
                    Toda a API
                  </button>
                </div>
                <p className="mb-2 text-[10px] leading-snug text-ink-500 dark:text-ink-500">
                  {navMode === "bot_automation"
                    ? "Token de perfil, API do bot (perfil, equipas, mensagens, estado e equipa da conversa), automações /automations, bots admin, conversas, mensagens e funil."
                    : "Todos os grupos publicados no JSON de sistema."}
                </p>
                <nav className="space-y-1.5">
                  <a className="block rounded px-2 py-1 text-sm hover:bg-ink-100 dark:hover:bg-ink-800" href="#guia-rapido">
                    Guia rápido
                  </a>
                  {(navMode === "bot_automation" ? botAutomationGroups : data.groups).map((g) => (
                    <a
                      key={`nav-${g.id}`}
                      className="block rounded px-2 py-1 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
                      href={`#group-${g.id}`}
                    >
                      {g.titlePt}
                    </a>
                  ))}
                </nav>
              </aside>

              <div className="space-y-10">
                <section
                  id="guia-rapido"
                  className="rounded-lg border border-brand-200/70 bg-gradient-to-br from-brand-50/80 to-white p-5 shadow-sm dark:border-brand-900/40 dark:from-brand-950/30 dark:to-ink-900/60"
                >
                  <h2 className="text-lg font-bold text-ink-900 dark:text-ink-100">Guia rápido para automação</h2>
                  <p className="mt-1 text-sm text-ink-700 dark:text-ink-300">
                    Fluxo recomendado: token de perfil ou bot (<code className="text-[11px]">ocb_</code>), listar equipas, atribuir conversa a equipa, etiquetas e funil CRM.
                  </p>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-md border border-ink-200/80 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/70">
                      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">1) Token do perfil</h3>
                      <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                        Endpoint: <code>{quickEndpoints?.tokenGenerate?.path ?? "/api/v1/auth/me/access-token"}</code>
                      </p>
                      <pre className="mt-3 overflow-auto rounded border border-ink-200 bg-ink-900/[0.03] p-2 font-mono text-[11px] dark:border-ink-700 dark:bg-black/25">
{`curl -X POST "https://SEU_DOMINIO/api/v1/auth/me/access-token" \\
  -H "Authorization: Bearer <jwt-admin>"`}
                      </pre>
                    </div>
                    <div className="rounded-md border border-ink-200/80 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/70">
                      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">2) Automação (ocu_)</h3>
                      <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                        Listar equipas, etiquetas e atribuir equipa ao ticket (admin no tenant).
                      </p>
                      <pre className="mt-3 overflow-auto rounded border border-ink-200 bg-ink-900/[0.03] p-2 font-mono text-[11px] dark:border-ink-700 dark:bg-black/25">
{`curl "https://SEU_DOMINIO/api/v1/automations/teams" \\
  -H "api_access_token: ocu_xxx"

curl -X PATCH "https://SEU_DOMINIO/api/v1/automations/conversations/<id>/team" \\
  -H "api_access_token: ocu_xxx" -H "Content-Type: application/json" \\
  -d '{"teamId":"<uuid-equipa>"}'`}
                      </pre>
                    </div>
                    <div className="rounded-md border border-ink-200/80 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/70">
                      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">3) Agent Bot (ocb_)</h3>
                      <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                        Mesmas operações de equipa com o token de inbox do bot.
                      </p>
                      <pre className="mt-3 overflow-auto rounded border border-ink-200 bg-ink-900/[0.03] p-2 font-mono text-[11px] dark:border-ink-700 dark:bg-black/25">
{`curl "https://SEU_DOMINIO/api/v1/agent-bot/teams" \\
  -H "Authorization: Bearer ocb_xxx"

curl -X PATCH "https://SEU_DOMINIO/api/v1/agent-bot/conversations/<id>/team" \\
  -H "Authorization: Bearer ocb_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"teamId":"<uuid-equipa>"}'`}
                      </pre>
                    </div>
                    <div className="rounded-md border border-ink-200/80 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/70">
                      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">4) Funil CRM</h3>
                      <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                        Consulte colunas e board para pipelines comerciais.
                      </p>
                      <pre className="mt-3 overflow-auto rounded border border-ink-200 bg-ink-900/[0.03] p-2 font-mono text-[11px] dark:border-ink-700 dark:bg-black/25">
{`curl "https://SEU_DOMINIO/api/v1/pipeline/board" \\
  -H "Authorization: Bearer <jwt>"`}
                      </pre>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
                    Endpoints-chave:{" "}
                    <code>{quickEndpoints?.ticketTags?.path ?? "/api/v1/automations/conversations/:id/tags"}</code>,{" "}
                    <code>{quickEndpoints?.automationTeams?.path ?? "/api/v1/automations/teams"}</code>,{" "}
                    <code>{quickEndpoints?.ticketTeam?.path ?? "/api/v1/automations/conversations/:id/team"}</code>,{" "}
                    <code>{quickEndpoints?.agentBotTeams?.path ?? "/api/v1/agent-bot/teams"}</code>,{" "}
                    <code>{quickEndpoints?.agentBotConvTeam?.path ?? "/api/v1/agent-bot/conversations/:id/team"}</code>,{" "}
                    <code>{quickEndpoints?.crmBoard?.path ?? "/api/v1/pipeline/board"}</code>,{" "}
                    <code>{quickEndpoints?.crmLeadTypes?.path ?? "/api/v1/lead-types"}</code>.
                  </p>
                </section>

                {(navMode === "bot_automation" ? botAutomationGroups : data.groups).map((g) => (
                  <DocsEndpointGroupSection key={g.id} g={g} />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
