import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useOutletContext } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { getArticleBySlug, getRelatedArticles } from "@/lib/help/articles";
import { getCategoryById } from "@/lib/help/categories";
import { isArticleVisible } from "@/lib/help/search";
import { buildSupportMessage, buildWhatsAppUrlFromPhone } from "@/lib/help/useHelpConfig";
import { ArticleRenderer } from "@/components/help/ArticleRenderer";
import { HelpBreadcrumb } from "@/components/help/HelpBreadcrumb";
import { HelpFeedback } from "@/components/help/HelpFeedback";
import { HelpTableOfContents } from "@/components/help/HelpTableOfContents";
import { pushRecentSlug } from "./HelpLayout";
import type { HelpOutletContext } from "./HelpLayout";
import { useI18n } from "@/i18n/I18nProvider";

export function HelpArticlePage() {
  const { t } = useI18n();
  const params = useParams();
  const { ctx, config } = useOutletContext<HelpOutletContext>();

  /** Catch-all splat: help/* → article slug */
  const slug = useMemo(() => {
    const parts = params["*"]?.split("/").filter(Boolean) ?? [];
    return parts.join("/");
  }, [params]);

  const article = slug ? getArticleBySlug(slug) : undefined;
  const category = article ? getCategoryById(article.categoryId) : undefined;
  const visible = article ? isArticleVisible(article, ctx) : false;

  useEffect(() => {
    if (article && visible) pushRecentSlug(article.slug);
  }, [article, visible]);

  if (!article || !visible) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-8 text-center dark:border-ink-700 dark:bg-ink-800/50">
        <p className="text-ink-600 dark:text-ink-400">{t("help.articleNotFound")}</p>
        <Link to="/help" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
          {t("help.backToHome")}
        </Link>
      </div>
    );
  }

  const related = getRelatedArticles(article).filter((a) => isArticleVisible(a, ctx));

  const supportMessage = buildSupportMessage(
    config.support.whatsappMessage,
    category ? `${category.title} > ${article.title}` : article.title,
  );

  const supportUrl = buildWhatsAppUrlFromPhone(config.support.phoneDisplay, supportMessage);

  const levelLabel =
    article.level === "basic"
      ? t("help.level.basic")
      : article.level === "intermediate"
        ? t("help.level.intermediate")
        : t("help.level.advanced");

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 max-w-3xl">
        <HelpBreadcrumb
          crumbs={[
            ...(category ? [{ label: category.title, to: `/help/${category.slug}` }] : []),
            { label: article.title },
          ]}
        />

        <header className="mb-8 border-b border-ink-100 pb-6 dark:border-ink-700">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl dark:text-white">
            {article.title}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-ink-600 dark:text-ink-400">{article.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-300">
              {levelLabel}
            </span>
            <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-300">
              {t("help.readTime").replace("{minutes}", String(article.readMinutes))}
            </span>
          </div>
        </header>

        <ArticleRenderer blocks={article.blocks} />

        {related.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{t("help.relatedTitle")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to={`/help/${r.slug}`}
                  className="rounded-xl border border-ink-200 bg-white p-4 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-800/50"
                >
                  <p className="font-medium text-ink-900 dark:text-ink-50">{r.title}</p>
                  <p className="mt-1 text-sm text-ink-500 line-clamp-2">{r.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {config.support.enabled ? (
          <section className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <h3 className="font-semibold text-ink-900 dark:text-ink-50">{t("help.support.needHelp")}</h3>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("help.support.articleHint")}</p>
            {supportUrl ? (
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <WhatsAppBrandIcon className="h-4 w-4" />
                {config.support.title}
                <ExternalLink className="h-3.5 w-3.5 opacity-80" />
              </a>
            ) : null}
          </section>
        ) : null}

        <HelpFeedback articleSlug={article.slug} />
      </article>

      <HelpTableOfContents blocks={article.blocks} />
    </div>
  );
}
