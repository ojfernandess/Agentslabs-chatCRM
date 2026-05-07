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
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-ink-100">
      <header className="border-b border-ink-200 bg-white/90 dark:border-ink-700 dark:bg-ink-900/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold">{tDoc("publicDocs.title")}</h1>
            <p className="text-sm text-ink-600 dark:text-ink-400">{tDoc("publicDocs.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/v1/public/system-documentation"
              className="btn-secondary text-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              {tDoc("publicDocs.jsonLink")}
            </a>
            <Link to="/login" className="btn-ghost text-sm">
              {tDoc("login.submit")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {loading ? (
          <p className="text-sm text-ink-600 dark:text-ink-400">{tDoc("common.loading")}</p>
        ) : error ? (
          <div className="card-surface border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : phase404 ? (
          <div className="card-surface p-6">
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{tDoc("publicDocs.disabledTitle")}</h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">{tDoc("publicDocs.disabledBody")}</p>
          </div>
        ) : data ? (
          <div className="space-y-8">
            <p className="rounded-lg border border-ink-200 bg-ink-100/50 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900/50">
              {data.noticePt}
            </p>
            <p className="text-xs text-ink-500">
              {tDoc("publicDocs.generatedAt")}: {new Date(data.generatedAt).toLocaleString("pt-BR")}
            </p>
            {data.groups.map((g) => (
              <section key={g.id} className="card-surface overflow-hidden dark:border-ink-700">
                <div className="border-b border-ink-200 bg-ink-50/80 px-4 py-3 dark:border-ink-700 dark:bg-ink-900/60">
                  <h2 className="font-semibold text-ink-900 dark:text-ink-50">{g.titlePt}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[48rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 text-xs uppercase text-ink-500 dark:border-ink-700">
                        <th className="px-4 py-2 font-medium">{tDoc("publicDocs.colMethod")}</th>
                        <th className="px-4 py-2 font-medium">{tDoc("publicDocs.colPath")}</th>
                        <th className="px-4 py-2 font-medium">{tDoc("publicDocs.authHeading")}</th>
                        <th className="px-4 py-2 font-medium">{tDoc("publicDocs.colDescription")}</th>
                        <th className="min-w-[12rem] px-4 py-2 font-medium">{tDoc("publicDocs.colExample")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.endpoints.map((row, idx) => (
                        <tr
                          key={`${g.id}-${idx}-${row.path}`}
                          className="border-b border-ink-100 align-top dark:border-ink-800"
                        >
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-brand-700 dark:text-brand-400">
                            {row.method}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs break-all text-ink-800 dark:text-ink-200">
                            {row.path}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-600 dark:text-ink-400">
                            {tDoc(`publicDocs.auth.${row.auth}`)}
                          </td>
                          <td className="px-4 py-2 text-ink-700 dark:text-ink-300">{row.descriptionPt}</td>
                          <td className="px-4 py-2 font-mono text-xs whitespace-pre-wrap text-ink-600 dark:text-ink-400">
                            {row.examplePayloadPt ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
