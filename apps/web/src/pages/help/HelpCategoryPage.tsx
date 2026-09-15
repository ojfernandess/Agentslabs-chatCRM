import { Link, useParams } from "react-router-dom";
import { useOutletContext } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getCategoryBySlug } from "@/lib/help/categories";
import { getArticlesByCategory } from "@/lib/help/articles";
import { isArticleVisible } from "@/lib/help/search";
import { HelpBreadcrumb } from "@/components/help/HelpBreadcrumb";
import type { HelpOutletContext } from "./HelpLayout";

type Props = { categorySlugOverride?: string };

export function HelpCategoryPage({ categorySlugOverride }: Props) {
  const { categorySlug: routeSlug } = useParams<{ categorySlug: string }>();
  const { ctx } = useOutletContext<HelpOutletContext>();

  const categorySlug = categorySlugOverride ?? routeSlug;
  const category = categorySlug ? getCategoryBySlug(categorySlug) : undefined;
  if (!category) {
    return <p className="text-ink-500">Categoria não encontrada.</p>;
  }

  const articles = getArticlesByCategory(category.id).filter((a) => isArticleVisible(a, ctx));

  return (
    <div>
      <HelpBreadcrumb crumbs={[{ label: category.title }]} />
      <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">{category.title}</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-400">{category.description}</p>

      <ul className="mt-8 divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white dark:divide-ink-700 dark:border-ink-700 dark:bg-ink-800/50">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              to={`/help/${article.slug}`}
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-ink-50 dark:hover:bg-ink-700/30"
            >
              <span>
                <span className="block font-medium text-ink-900 dark:text-ink-50">{article.title}</span>
                <span className="mt-0.5 block text-sm text-ink-500">{article.description}</span>
                <span className="mt-1 inline-flex gap-2 text-xs text-ink-400">
                  <span>{article.readMinutes} min</span>
                  <span>·</span>
                  <span className="capitalize">{article.level}</span>
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
