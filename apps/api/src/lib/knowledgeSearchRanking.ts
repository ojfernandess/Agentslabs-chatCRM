export type RankableArticle = {
  id: string;
  title: string;
  content: string;
};

/** Extrai termos da consulta (min 2 caracteres). */
export function queryTerms(normalizedQuery: string): string[] {
  const raw = normalizedQuery
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return [...new Set(raw)];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pontuação 0–1: título pesa mais; contagens no corpo com teto. */
export function scoreArticle(article: RankableArticle, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = article.title.toLowerCase();
  const content = article.content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    if (title.includes(t)) score += 0.38;
    const re = new RegExp(escapeRegExp(t), "gi");
    const matches = content.match(re);
    const n = matches?.length ?? 0;
    score += Math.min(0.22, n * 0.035);
  }
  return Math.min(1, score);
}

export function excerptAround(article: RankableArticle, terms: string[], maxLen = 220): string {
  const lower = article.content.toLowerCase();
  if (!terms.length) return article.content.slice(0, maxLen) + (article.content.length > maxLen ? "…" : "");
  for (const term of terms) {
    const t = term.toLowerCase();
    const i = lower.indexOf(t);
    if (i >= 0) {
      const start = Math.max(0, i - 60);
      const slice = article.content.slice(start, start + maxLen);
      return (start > 0 ? "…" : "") + slice + (start + maxLen < article.content.length ? "…" : "");
    }
  }
  return article.content.slice(0, maxLen) + (article.content.length > maxLen ? "…" : "");
}

export function rankArticles<T extends RankableArticle>(
  articles: T[],
  normalizedQuery: string,
): Array<{ article: T; score: number; excerpt: string }> {
  const terms = queryTerms(normalizedQuery);
  const ranked = articles.map((article) => ({
    article,
    score: scoreArticle(article, terms.length ? terms : [normalizedQuery.trim().toLowerCase()].filter(Boolean)),
    excerpt: excerptAround(article, terms.length ? terms : [normalizedQuery.trim().toLowerCase()].filter(Boolean)),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
