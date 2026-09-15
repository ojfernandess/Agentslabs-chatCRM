import type { HelpArticle, HelpSearchResult } from "./types";
import { HELP_CATEGORIES, getCategoryById } from "./categories";
import { HELP_ARTICLES } from "./articles";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function tokenize(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreField(text: string, tokens: string[]): number {
  const n = normalize(text);
  let score = 0;
  for (const token of tokens) {
    if (n === token) score += 10;
    else if (n.includes(token)) score += 5;
  }
  return score;
}

export type HelpFilterContext = {
  isAdmin: boolean;
  features: Record<string, boolean | undefined>;
};

export function isArticleVisible(article: HelpArticle, ctx: HelpFilterContext): boolean {
  if (article.requiresAdmin && !ctx.isAdmin) return false;
  if (article.featureFlag) {
    const enabled = ctx.features[article.featureFlag];
    if (enabled === false) return false;
  }
  return true;
}

export function isCategoryVisible(
  category: (typeof HELP_CATEGORIES)[number],
  ctx: HelpFilterContext,
): boolean {
  if (category.requiresAdmin && !ctx.isAdmin) return false;
  if (category.featureFlag) {
    const enabled = ctx.features[category.featureFlag];
    if (enabled === false) return false;
  }
  return true;
}

export function searchHelpArticles(query: string, ctx: HelpFilterContext): HelpSearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results: HelpSearchResult[] = [];

  for (const article of HELP_ARTICLES) {
    if (!isArticleVisible(article, ctx)) continue;
    const category = getCategoryById(article.categoryId);
    if (!category || !isCategoryVisible(category, ctx)) continue;

    let score = 0;
    const matchedIn: HelpSearchResult["matchedIn"] = [];

    const titleScore = scoreField(article.title, tokens);
    if (titleScore > 0) {
      score += titleScore * 2;
      matchedIn.push("title");
    }

    const descScore = scoreField(article.description, tokens);
    if (descScore > 0) {
      score += descScore;
      matchedIn.push("description");
    }

    for (const kw of article.keywords) {
      const kwScore = scoreField(kw, tokens);
      if (kwScore > 0) {
        score += kwScore;
        if (!matchedIn.includes("keywords")) matchedIn.push("keywords");
      }
    }

    if (score > 0) {
      results.push({ article, category, score, matchedIn });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function highlightMatch(text: string, query: string): string {
  const tokens = tokenize(query);
  if (tokens.length === 0) return text;
  let result = text;
  for (const token of tokens) {
    const re = new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    result = result.replace(re, "**$1**");
  }
  return result;
}
