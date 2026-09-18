import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronRight, Clock, MessageSquare } from "lucide-react";
import { motion, staggerContainer, staggerItem, useReducedMotion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { attendantDisplayName } from "@/lib/cannedResponseVariables";
import { getArticleBySlug } from "@/lib/help/articles";
import { getContextualArticles } from "@/lib/help/routeContext";
import { isArticleVisible } from "@/lib/help/search";
import type { HelpArticle } from "@/lib/help/types";
import { useHelpConfig } from "@/lib/help/useHelpConfig";

const EXTRA_GUIDE_SLUGS = ["conversations/first-conversation", "contacts/overview"] as const;

function collectGuideArticles(isAdmin: boolean, features: Record<string, boolean | undefined>): HelpArticle[] {
  const ctx = { isAdmin, features };
  const seen = new Set<string>();
  const articles: HelpArticle[] = [];

  const push = (article: HelpArticle | undefined) => {
    if (!article || seen.has(article.slug) || !isArticleVisible(article, ctx)) return;
    seen.add(article.slug);
    articles.push(article);
  };

  for (const article of getContextualArticles("/conversations", ctx)) {
    push(article);
  }
  for (const slug of EXTRA_GUIDE_SLUGS) {
    push(getArticleBySlug(slug));
  }

  return articles.slice(0, 4);
}

export function ConversationsThreadPlaceholder() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { config } = useHelpConfig();
  const reduceMotion = useReducedMotion();

  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const features = user?.organizationFeatures ?? {};

  const guideArticles = useMemo(() => collectGuideArticles(isAdmin, features), [isAdmin, features]);
  const showGuide = config.guide.enabled && guideArticles.length > 0;
  const agentName = attendantDisplayName(user);
  const greeting = agentName
    ? t("conversations.emptyWorkspaceGreeting").replace("{name}", agentName)
    : t("conversations.emptyWorkspaceGreetingFallback");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-brand-50/80 via-ink-50 to-ink-50 dark:from-brand-950/20 dark:via-[#0F1420] dark:to-[#0F1420]">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-10 sm:py-12">
        <motion.div
          className="flex flex-col items-center text-center"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <motion.div
            className="relative mb-5 flex h-24 w-24 items-center justify-center"
            animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
            transition={reduceMotion ? undefined : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            {!reduceMotion ? (
              <>
                <motion.span
                  aria-hidden
                  className="absolute inset-2 rounded-full bg-brand-400/25"
                  animate={{ scale: [1, 1.45, 1], opacity: [0.45, 0, 0.45] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.span
                  aria-hidden
                  className="absolute inset-4 rounded-full bg-brand-500/15"
                  animate={{ scale: [1, 1.25, 1], opacity: [0.35, 0.1, 0.35] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                />
              </>
            ) : null}
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/30">
              <MessageSquare className="h-8 w-8 text-white" aria-hidden />
            </div>
          </motion.div>

          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-50 sm:text-2xl">{greeting}</h2>

          <p className="mt-3 text-base font-medium text-ink-800 dark:text-ink-100">
            {t("conversations.selectThread")}
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            {t("conversations.selectThreadHint")}
          </p>
        </motion.div>

        {showGuide ? (
          <motion.section
            className="mt-10 w-full"
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.2 }}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                <BookOpen className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">
                  {t("conversations.emptyWorkspaceGuideTitle")}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                  {t("conversations.emptyWorkspaceGuideDesc")}
                </p>
              </div>
            </div>

            <motion.div
              className="mt-4 grid gap-3 sm:grid-cols-2"
              variants={reduceMotion ? undefined : staggerContainer}
              initial={reduceMotion ? undefined : "hidden"}
              animate={reduceMotion ? undefined : "show"}
            >
              {guideArticles.map((article) => (
                <motion.div key={article.slug} variants={reduceMotion ? undefined : staggerItem}>
                  <Link
                    to={`/help/${article.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-white p-4 transition-all hover:border-brand-300 hover:shadow-md dark:border-ink-700 dark:bg-ink-800/50 dark:hover:border-brand-700"
                  >
                    <p className="font-semibold text-ink-900 group-hover:text-brand-600 dark:text-ink-50 dark:group-hover:text-brand-400">
                      {article.title}
                    </p>
                    <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-500 line-clamp-2 dark:text-ink-400">
                      {article.description}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-ink-500 dark:text-ink-400">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      {t("help.readTime").replace("{minutes}", String(article.readMinutes))}
                      <ChevronRight className="ml-auto h-4 w-4 text-brand-500 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </Link>
                </motion.div>
              ))}
            </motion.div>

            <div className="mt-5 flex justify-center">
              <Link
                to="/help/conversations/overview"
                className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {t("conversations.emptyWorkspaceViewGuide")}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.section>
        ) : null}
      </div>
    </div>
  );
}
