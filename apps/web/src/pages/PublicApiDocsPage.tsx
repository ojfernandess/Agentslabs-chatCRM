import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { translate } from "@/i18n/messages";

const DOC_LOCALE = "pt-BR" as const;

type PublicApiDocError = { status: number; descriptionPt: string };

type PublicEndpoint = {
  method: string;
  path: string;
  auth: string;
  slug: string;
  descriptionEn: string;
  descriptionPt: string;
  examplePayloadPt?: string;
  successStatus: number;
  exampleResponsePt: string;
  errors: PublicApiDocError[];
};

type PublicDocsPayload = {
  schemaVersion: number;
  generatedAt: string;
  noticeEn: string;
  noticePt: string;
  conventions: {
    errorFormatPt: string;
    errorExampleJson: string;
    paginationPt: string;
    paginationExampleJson: string;
    filtersPt: string;
    rateLimitPt: string;
    versioningPt: string;
    authTable: {
      tokenTypePt: string;
      prefix: string;
      howToObtainPt: string;
      whereToUsePt: string;
      whoCanUsePt: string;
    }[];
  };
  schemas: {
    id: string;
    namePt: string;
    descriptionPt: string;
    fields: {
      name: string;
      type: string;
      required: boolean;
      enumValues?: string[];
      descriptionPt: string;
    }[];
  }[];
  changelog: {
    date: string;
    schemaVersion: number;
    titlePt: string;
    changesPt: string[];
    breaking: boolean;
  }[];
  groups: {
    id: string;
    titleEn: string;
    titlePt: string;
    endpoints: PublicEndpoint[];
  }[];
};

const tDoc = (path: string) => translate(DOC_LOCALE, path);

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
  return methodField.split("|").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function accentForMethods(methods: string[]) {
  const first = methods[0];
  return (first && METHOD_ACCENTS[first]) || METHOD_FALLBACK;
}

function authPillLabel(authKey: string): string {
  const full = `publicDocs.auth.${authKey}`;
  const label = tDoc(full);
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

/** Bloco de código sem truncamento horizontal — adequado para web e impressão. */
function DocCodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-visible whitespace-pre-wrap break-words rounded-md border border-ink-200/80 bg-ink-900/[0.03] p-3 font-mono text-[11px] leading-relaxed text-ink-800 print:overflow-visible print:whitespace-pre-wrap dark:border-ink-700 dark:bg-black/25 dark:text-ink-300">
      {children.trim() || "—"}
    </pre>
  );
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
      out.push({ ...auth, id: "auth_automation", titlePt: "Login e token de perfil (integrações)", endpoints });
  }
  if (agentBot?.endpoints.length) out.push(agentBot);
  if (tenant) {
    const endpoints = tenant.endpoints.filter(isTenantEndpointForBotAutomation);
    if (endpoints.length)
      out.push({ ...tenant, id: "tenant_automation", titlePt: "Tickets, gestão de bots, automação e funil CRM", endpoints });
  }
  return out;
}

function endpointMatchesQuery(ep: PublicEndpoint, q: string): boolean {
  const hay = `${ep.method} ${ep.path} ${ep.descriptionPt} ${ep.auth}`.toLowerCase();
  return hay.includes(q);
}

function AuthTable({ rows }: { rows: PublicDocsPayload["conventions"]["authTable"] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-ink-200/80 dark:border-ink-700">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="bg-ink-100/80 dark:bg-ink-800/80">
          <tr>
            <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.authTable.type")}</th>
            <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.authTable.prefix")}</th>
            <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.authTable.how")}</th>
            <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.authTable.where")}</th>
            <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.authTable.who")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
          {rows.map((row) => (
            <tr key={row.tokenTypePt} className="bg-white dark:bg-ink-900/50">
              <td className="px-3 py-2 font-medium text-ink-900 dark:text-ink-100">{row.tokenTypePt}</td>
              <td className="px-3 py-2 font-mono text-ink-700 dark:text-ink-300">{row.prefix}</td>
              <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{row.howToObtainPt}</td>
              <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{row.whereToUsePt}</td>
              <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{row.whoCanUsePt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorCodesTable({ errors }: { errors: PublicApiDocError[] }) {
  if (!errors.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-ink-200/80 dark:border-ink-700">
      <table className="w-full text-left text-xs">
        <thead className="bg-ink-100/80 dark:bg-ink-800/80">
          <tr>
            <th className="px-3 py-2 font-semibold w-20">{tDoc("publicDocs.colStatus")}</th>
            <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.colErrorWhen")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
          {errors.map((e) => (
            <tr key={e.status} className="bg-white dark:bg-ink-900/50">
              <td className="px-3 py-2 font-mono font-bold text-rose-700 dark:text-rose-300">{e.status}</td>
              <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{e.descriptionPt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocsEndpointRow({ row, groupId }: { row: PublicEndpoint; groupId: string }) {
  const methods = parseMethods(row.method);
  const { bar } = accentForMethods(methods);
  return (
    <li
      id={row.slug}
      key={`${groupId}-${row.slug}`}
      className={`scroll-mt-24 border-l-4 ${bar} bg-ink-50/20 dark:bg-ink-950/20`}
    >
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <MethodPills methods={methods} />
          <span className="rounded-full bg-ink-200/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-700 dark:bg-ink-800 dark:text-ink-400">
            {authPillLabel(row.auth)}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            {row.successStatus}
          </span>
          <a
            href={`#${row.slug}`}
            className="ml-auto text-[10px] text-brand-600 hover:underline dark:text-brand-400"
            title={tDoc("publicDocs.copyAnchor")}
          >
            #{row.slug}
          </a>
        </div>
        <code className="block break-all font-mono text-[13px] font-medium leading-snug text-ink-900 dark:text-ink-100">
          {row.path}
        </code>
        <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-300">{row.descriptionPt}</p>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{tDoc("publicDocs.colExample")}</span>
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden />
          </div>
          <DocCodeBlock>{row.examplePayloadPt ?? ""}</DocCodeBlock>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{tDoc("publicDocs.colResponse")}</span>
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden />
          </div>
          <DocCodeBlock>{row.exampleResponsePt}</DocCodeBlock>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{tDoc("publicDocs.colErrors")}</span>
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden />
          </div>
          <ErrorCodesTable errors={row.errors} />
        </div>
      </div>
    </li>
  );
}

function DocsEndpointGroupSection({ g }: { g: PublicDocsPayload["groups"][number] }) {
  return (
    <section
      id={`group-${g.id}`}
      className="scroll-mt-24 overflow-hidden rounded-lg border border-ink-200/90 bg-white shadow-md dark:border-ink-700/90 dark:bg-ink-900/80 dark:shadow-none"
    >
      <div className="border-b border-ink-200 bg-gradient-to-r from-ink-50 to-white px-5 py-4 dark:border-ink-700 dark:from-ink-900 dark:to-ink-900/50">
        <h2 className="text-base font-bold tracking-tight text-ink-900 dark:text-white">{g.titlePt}</h2>
        <p className="mt-0.5 text-xs font-medium text-ink-500">
          {g.endpoints.length} {g.endpoints.length === 1 ? "rota" : "rotas"}
        </p>
      </div>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800/80">
        {g.endpoints.map((row) => (
          <DocsEndpointRow key={row.slug} row={row} groupId={g.id} />
        ))}
      </ul>
    </section>
  );
}

export function PublicApiDocsPage() {
  const [data, setData] = useState<PublicDocsPayload | null>(null);
  const [phase404, setPhase404] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [navMode, setNavMode] = useState<"bot_automation" | "full">("full");
  const [search, setSearch] = useState("");

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

  const activeGroups = useMemo(() => {
    if (!data) return [];
    const base = navMode === "bot_automation" ? buildBotAutomationGroups(data) : data.groups;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter((ep) => endpointMatchesQuery(ep, q)),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [data, navMode, search]);

  const navEntries = useMemo(() => {
    if (!data) return [];
    const base = navMode === "bot_automation" ? buildBotAutomationGroups(data) : data.groups;
    const q = search.trim().toLowerCase();
    return base.flatMap((g) => {
      const eps = q ? g.endpoints.filter((ep) => endpointMatchesQuery(ep, q)) : g.endpoints;
      if (!eps.length && q) return [];
      return [{ kind: "group" as const, id: g.id, title: g.titlePt }, ...eps.map((ep) => ({ kind: "endpoint" as const, ep, groupId: g.id }))];
    });
  }, [data, navMode, search]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-ink-100/90 via-ink-50 to-ink-50 text-ink-900 dark:from-ink-950 dark:via-ink-950 dark:to-[#0d1218] dark:text-ink-100 print:bg-white">
      <header className="sticky top-0 z-10 border-b border-ink-200/80 bg-white/80 shadow-sm backdrop-blur-md dark:border-ink-800/80 dark:bg-ink-900/75 print:static">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
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
            <a href="/api/v1/public/system-documentation" className="btn-secondary text-sm shadow-sm" target="_blank" rel="noopener noreferrer">
              {tDoc("publicDocs.jsonLink")}
            </a>
            {data ? (
              <a
                href={`/api/v1/public/system-documentation/postman`}
                className="btn-secondary text-sm shadow-sm"
                download={`opennexo-crm-api-v${data.schemaVersion}.postman_collection.json`}
                title={tDoc("publicDocs.postmanHint")}
              >
                {tDoc("publicDocs.postmanLink")}
              </a>
            ) : null}
            <Link to="/login" className="btn-ghost text-sm font-semibold">
              {tDoc("login.submit")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 pb-16 print:max-w-none">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />
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
            <p className="rounded-lg border border-ink-200/80 bg-white/60 px-4 py-3 text-sm leading-relaxed text-ink-700 shadow-sm dark:border-ink-700/80 dark:bg-ink-900/40 dark:text-ink-300">
              {data.noticePt}
            </p>

            <div className="mt-8 grid gap-6 lg:grid-cols-[280px,minmax(0,1fr)] print:block">
              <aside className="h-fit rounded-lg border border-ink-200/90 bg-white p-4 shadow-sm dark:border-ink-700/90 dark:bg-ink-900/80 print:hidden lg:sticky lg:top-24">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">{tDoc("publicDocs.navTitle")}</p>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tDoc("publicDocs.searchPlaceholder")}
                  className="mb-3 w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
                />
                <div className="mb-3 flex rounded-lg border border-ink-200/90 p-0.5 dark:border-ink-700">
                  <button
                    type="button"
                    onClick={() => setNavMode("full")}
                    className={`flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold leading-tight transition-colors ${
                      navMode === "full" ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600" : "text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
                    }`}
                  >
                    {tDoc("publicDocs.navFullApi")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavMode("bot_automation")}
                    className={`flex-1 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold leading-tight transition-colors ${
                      navMode === "bot_automation" ? "bg-brand-500 text-white shadow-sm dark:bg-brand-600" : "text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
                    }`}
                  >
                    {tDoc("publicDocs.navBotAutomation")}
                  </button>
                </div>
                <nav className="max-h-[70vh] space-y-0.5 overflow-y-auto text-sm">
                  <a className="block rounded px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800" href="#convencoes">
                    {tDoc("publicDocs.navConventions")}
                  </a>
                  <a className="block rounded px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800" href="#autenticacao">
                    {tDoc("publicDocs.navAuth")}
                  </a>
                  <a className="block rounded px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800" href="#modelos">
                    {tDoc("publicDocs.navSchemas")}
                  </a>
                  <a className="block rounded px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800" href="#changelog">
                    {tDoc("publicDocs.navChangelog")}
                  </a>
                  <a className="block rounded px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800" href="#guia-rapido">
                    {tDoc("publicDocs.navQuickGuide")}
                  </a>
                  <a className="block rounded px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800" href="#guia-email">
                    {tDoc("publicDocs.navEmailGuide")}
                  </a>
                  {navEntries.map((entry, i) =>
                    entry.kind === "group" ? (
                      <a
                        key={`g-${entry.id}`}
                        className="mt-2 block rounded px-2 py-1 font-semibold text-ink-800 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
                        href={`#group-${entry.id}`}
                      >
                        {entry.title}
                      </a>
                    ) : (
                      <a
                        key={`e-${entry.ep.slug}-${i}`}
                        className="block truncate rounded py-0.5 pl-4 pr-2 font-mono text-[11px] text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
                        href={`#${entry.ep.slug}`}
                        title={entry.ep.path}
                      >
                        {parseMethods(entry.ep.method)[0]} {entry.ep.path}
                      </a>
                    ),
                  )}
                </nav>
              </aside>

              <div className="space-y-10 print:space-y-6">
                <section id="convencoes" className="scroll-mt-24 rounded-lg border border-ink-200/90 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900/80">
                  <h2 className="text-lg font-bold text-ink-900 dark:text-white">{tDoc("publicDocs.conventionsTitle")}</h2>
                  <div className="mt-4 space-y-6 text-sm text-ink-700 dark:text-ink-300">
                    <div>
                      <h3 className="font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.conventionsErrors")}</h3>
                      <p className="mt-1 whitespace-pre-line">{data.conventions.errorFormatPt}</p>
                      <div className="mt-2">
                        <DocCodeBlock>{data.conventions.errorExampleJson}</DocCodeBlock>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.conventionsPagination")}</h3>
                      <p className="mt-1 whitespace-pre-line">{data.conventions.paginationPt}</p>
                      <div className="mt-2">
                        <DocCodeBlock>{data.conventions.paginationExampleJson}</DocCodeBlock>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.conventionsFilters")}</h3>
                      <p className="mt-1 whitespace-pre-line">{data.conventions.filtersPt}</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.conventionsRateLimit")}</h3>
                      <p className="mt-1">{data.conventions.rateLimitPt}</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.conventionsVersioning")}</h3>
                      <p className="mt-1">{data.conventions.versioningPt}</p>
                    </div>
                  </div>
                </section>

                <section
                  id="autenticacao"
                  className="scroll-mt-24 rounded-lg border border-brand-200/70 bg-gradient-to-br from-brand-50/90 to-white px-4 py-4 shadow-sm dark:border-brand-900/40 dark:from-brand-950/30 dark:to-ink-900/60"
                >
                  <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.authLegendTitle")}</h2>
                  <AuthTable rows={data.conventions.authTable} />
                </section>

                <section id="modelos" className="scroll-mt-24 rounded-lg border border-ink-200/90 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900/80">
                  <h2 className="text-lg font-bold text-ink-900 dark:text-white">{tDoc("publicDocs.schemasTitle")}</h2>
                  <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{tDoc("publicDocs.schemasIntro")}</p>
                  <div className="mt-4 space-y-6">
                    {data.schemas.map((schema) => (
                      <div key={schema.id} id={`schema-${schema.id}`} className="scroll-mt-24">
                        <h3 className="font-semibold text-ink-900 dark:text-ink-100">
                          {schema.namePt}
                          <span className="ml-2 text-xs font-normal text-ink-500">— {schema.descriptionPt}</span>
                        </h3>
                        <div className="mt-2 overflow-x-auto rounded-md border border-ink-200/80 dark:border-ink-700">
                          <table className="w-full min-w-[520px] text-left text-xs">
                            <thead className="bg-ink-100/80 dark:bg-ink-800/80">
                              <tr>
                                <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.schemaColField")}</th>
                                <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.schemaColType")}</th>
                                <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.schemaColRequired")}</th>
                                <th className="px-3 py-2 font-semibold">{tDoc("publicDocs.schemaColDesc")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                              {schema.fields.map((f) => (
                                <tr key={f.name} className="bg-white dark:bg-ink-900/50">
                                  <td className="px-3 py-2 font-mono text-ink-900 dark:text-ink-100">{f.name}</td>
                                  <td className="px-3 py-2 font-mono text-ink-600 dark:text-ink-400">
                                    {f.enumValues ? f.enumValues.join(" | ") : f.type}
                                  </td>
                                  <td className="px-3 py-2">{f.required ? tDoc("publicDocs.yes") : tDoc("publicDocs.no")}</td>
                                  <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{f.descriptionPt}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section id="changelog" className="scroll-mt-24 rounded-lg border border-ink-200/90 bg-white p-5 shadow-sm dark:border-ink-700 dark:bg-ink-900/80">
                  <h2 className="text-lg font-bold text-ink-900 dark:text-white">{tDoc("publicDocs.changelogTitle")}</h2>
                  <ol className="mt-4 space-y-4">
                    {data.changelog.map((entry) => (
                      <li key={`${entry.date}-${entry.schemaVersion}`} className="border-l-2 border-brand-400 pl-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <time className="text-xs font-mono text-ink-500">{entry.date}</time>
                          <span className="rounded bg-ink-200/80 px-1.5 py-0.5 font-mono text-[10px] dark:bg-ink-800">
                            schema v{entry.schemaVersion}
                          </span>
                          {entry.breaking ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
                              BREAKING
                            </span>
                          ) : null}
                        </div>
                        <h3 className="mt-1 font-semibold text-ink-900 dark:text-ink-100">{entry.titlePt}</h3>
                        <ul className="mt-1 list-inside list-disc text-sm text-ink-600 dark:text-ink-400">
                          {entry.changesPt.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </section>

                {/* Guias rápidos — mantidos, com DocCodeBlock */}
                <section id="guia-rapido" className="scroll-mt-24 rounded-lg border border-brand-200/70 bg-gradient-to-br from-brand-50/80 to-white p-5 shadow-sm dark:border-brand-900/40 dark:from-brand-950/30 dark:to-ink-900/60 print:break-inside-avoid">
                  <h2 className="text-lg font-bold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.automationGuideTitle")}</h2>
                  <p className="mt-1 text-sm text-ink-700 dark:text-ink-300">{tDoc("publicDocs.automationGuideIntro")}</p>
                  <p className="mt-3 text-xs text-ink-500">
                    {tDoc("publicDocs.emailGuideKeyEndpoints")}:{" "}
                    <a className="text-brand-600 underline" href="#api-v1-automations-conversations-id-tags">
                      automations/tags
                    </a>
                    ,{" "}
                    <a className="text-brand-600 underline" href="#api-v1-pipeline-board">
                      pipeline/board
                    </a>
                  </p>
                </section>

                <section id="guia-email" className="scroll-mt-24 rounded-lg border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-white p-5 shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/25 dark:to-ink-900/60 print:break-inside-avoid">
                  <h2 className="text-lg font-bold text-ink-900 dark:text-ink-100">{tDoc("publicDocs.emailGuideTitle")}</h2>
                  <p className="mt-1 text-sm text-ink-700 dark:text-ink-300">{tDoc("publicDocs.emailGuideIntro")}</p>
                  <p className="mt-3 text-xs text-ink-500">
                    <a className="text-brand-600 underline" href="#group-email_workspace">
                      Workspace de e-mail
                    </a>
                  </p>
                </section>

                {search && activeGroups.length === 0 ? (
                  <p className="text-sm text-ink-500">{tDoc("publicDocs.searchEmpty")}</p>
                ) : null}

                {activeGroups.map((g) => (
                  <DocsEndpointGroupSection key={g.id} g={g} />
                ))}

                <p className="text-xs text-ink-500">
                  {tDoc("publicDocs.generatedAt")}:{" "}
                  <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString("pt-BR")}</time>
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
