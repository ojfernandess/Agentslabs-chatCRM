import { useEffect, useState } from "react";
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

export function PublicApiDocsPage() {
  const [data, setData] = useState<PublicDocsPayload | null>(null);
  const [phase404, setPhase404] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

      <main className="mx-auto max-w-5xl px-4 py-10 pb-16">
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
          <div className="space-y-10 animate-fade-in">
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

            {data.groups.map((g) => (
              <section
                key={g.id}
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
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
