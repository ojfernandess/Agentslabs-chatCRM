import type { HelpArticle } from "../types";
import { gettingStartedArticles } from "./gettingStarted";
import { botsArticles } from "./bots";
import { campaignsArticles } from "./campaigns";
import { automationArticles } from "./automation";
import { conversationsArticles } from "./conversations";
import { crmArticles } from "./crm";
import { dealsArticles } from "./deals";
import { contactsArticles } from "./contacts";
import { settingsArticles } from "./settings";
import { analyticsArticles } from "./analytics";
import { teamsArticles } from "./teams";
import { glossaryArticles } from "./glossary";

export const HELP_ARTICLES: HelpArticle[] = [
  ...gettingStartedArticles,
  ...botsArticles,
  ...campaignsArticles,
  ...automationArticles,
  ...conversationsArticles,
  ...crmArticles,
  ...dealsArticles,
  ...contactsArticles,
  ...settingsArticles,
  ...analyticsArticles,
  ...teamsArticles,
  ...glossaryArticles,
];

export function getArticleBySlug(slug: string): HelpArticle | undefined {
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  return HELP_ARTICLES.find((a) => a.slug === normalized);
}

export function getArticlesByCategory(categoryId: string): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.categoryId === categoryId).sort((a, b) =>
    a.title.localeCompare(b.title, "pt-BR"),
  );
}

export function getRelatedArticles(article: HelpArticle): HelpArticle[] {
  if (!article.relatedSlugs?.length) return [];
  return article.relatedSlugs
    .map((s) => getArticleBySlug(s))
    .filter((a): a is HelpArticle => Boolean(a));
}

/** FAQ suggestions shown in help modal */
export const HELP_FAQ_SLUGS = [
  "bots/create",
  "campaigns/create",
  "automation/overview",
  "conversations/overview",
  "deals/create",
];
