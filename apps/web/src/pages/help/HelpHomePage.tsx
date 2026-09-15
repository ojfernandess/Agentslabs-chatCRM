import { Link } from "react-router-dom";
import { ChevronRight, Rocket } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import { useI18n } from "@/i18n/I18nProvider";
import {
  GETTING_STARTED_TRAIL,
  HELP_CATEGORIES,
  HELP_GOAL_CARDS,
} from "@/lib/help/categories";
import { getArticleBySlug } from "@/lib/help/articles";
import { isCategoryVisible } from "@/lib/help/search";
import type { HelpOutletContext } from "./HelpLayout";

export function HelpHomePage() {
  const { t } = useI18n();
  const { ctx } = useOutletContext<HelpOutletContext>();

  const trail = GETTING_STARTED_TRAIL.filter((step) => {
    if (step.requiresAdmin && !ctx.isAdmin) return false;
    if (step.featureFlag && ctx.features[step.featureFlag] === false) return false;
    return Boolean(getArticleBySlug(step.articleSlug));
  });

  const goals = HELP_GOAL_CARDS.filter((g) => {
    if (g.requiresAdmin && !ctx.isAdmin) return false;
    if (g.featureFlag && ctx.features[g.featureFlag] === false) return false;
    return Boolean(getArticleBySlug(g.articleSlug));
  });

  const categories = HELP_CATEGORIES.filter((c) => isCategoryVisible(c, ctx)).sort(
    (a, b) => a.order - b.order,
  );

  return (
    <div className="space-y-10">
      {trail.length > 0 ? (
        <section className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 dark:border-brand-900/50 dark:from-brand-950/30 dark:to-ink-900">
          <div className="flex items-start gap-3">
            <Rocket className="h-6 w-6 shrink-0 text-brand-600 dark:text-brand-400" />
            <div>
              <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{t("help.home.newHere")}</h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("help.home.newHereDesc")}</p>
              <Link
                to={`/help/${trail[0]!.articleSlug}`}
                className="mt-4 inline-flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {t("help.home.startNow")}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <ol className="mt-6 space-y-2 border-t border-brand-200/60 pt-4 dark:border-brand-900/40">
            {trail.map((step) => (
              <li key={step.order}>
                <Link
                  to={`/help/${step.articleSlug}`}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/60 dark:hover:bg-ink-800/40"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                    {step.order}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-ink-900 dark:text-ink-100">{step.title}</span>
                    <span className="text-xs text-ink-500">{step.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {goals.length > 0 ? (
        <section>
          <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{t("help.home.goalsTitle")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {goals.map((g) => (
              <Link
                key={g.id}
                to={`/help/${g.articleSlug}`}
                className="group rounded-2xl border border-ink-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-ink-700 dark:bg-ink-800/50"
              >
                <p className="font-semibold text-ink-900 group-hover:text-brand-600 dark:text-ink-50 dark:group-hover:text-brand-400">
                  {g.title}
                </p>
                <p className="mt-1 text-sm text-ink-500">{g.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{t("help.home.exploreCategories")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={cat.slug === "glossary" ? "/help/glossary" : `/help/${cat.slug}`}
              className="rounded-2xl border border-ink-200 bg-white p-4 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-800/50 dark:hover:border-brand-700"
            >
              <p className="font-semibold text-ink-900 dark:text-ink-50">{cat.title}</p>
              <p className="mt-1 text-sm text-ink-500 line-clamp-2">{cat.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-ink-50 p-6 text-center dark:border-ink-700 dark:bg-ink-800/40">
        <h2 className="font-semibold text-ink-900 dark:text-ink-50">{t("help.home.needMore")}</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("help.home.needMoreDesc")}</p>
        <p className="mt-3 text-sm text-ink-500">{t("help.home.useHelpButton")}</p>
      </section>
    </div>
  );
}
