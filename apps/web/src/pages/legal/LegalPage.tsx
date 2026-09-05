import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { getLegalDocument, isLegalSlug } from "@/content/legalDocuments";
import { LoginFooter } from "@/components/auth/LoginFooter";
import { brandAssetUrl } from "@/lib/brandingAssets";

export function LegalPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useI18n();

  if (!slug || !isLegalSlug(slug)) {
    return <Navigate to="/login" replace />;
  }

  const doc = getLegalDocument(slug, locale);

  return (
    <div className="flex min-h-dvh flex-col bg-[#f6f4fb] dark:bg-ink-950">
      <header className="border-b border-ink-200 bg-white px-6 py-4 dark:border-ink-800 dark:bg-ink-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
            <ArrowLeft className="h-4 w-4" />
            {t("legal.backToLogin")}
          </Link>
          <img src={brandAssetUrl("/logo.svg")} alt="OpenNexo CRM" className="h-8 w-auto" decoding="async" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <article className="rounded-2xl border border-ink-200 bg-white p-8 shadow-sm dark:border-ink-700 dark:bg-ink-900">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{doc.title}</h1>
          <p className="mt-2 text-xs text-ink-500">
            {t("legal.lastUpdated")}: {doc.updatedAt}
          </p>

          <div className="prose prose-sm mt-8 max-w-none dark:prose-invert">
            {doc.sections.map((section, idx) => (
              <section key={idx} className="mb-8 last:mb-0">
                {section.heading ? (
                  <h2 className="mb-3 text-base font-semibold text-ink-900 dark:text-ink-100">
                    {section.heading}
                  </h2>
                ) : null}
                {(section.paragraphs ?? []).map((p, pIdx) => (
                  <p key={pIdx} className="mb-3 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
                    {p}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul className="ml-4 list-disc space-y-2 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
                    {section.bullets.map((item, bIdx) => (
                      <li key={bIdx}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </main>

      <LoginFooter />
    </div>
  );
}
