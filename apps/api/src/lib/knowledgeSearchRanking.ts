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

const QUERY_ESTABLISHMENT_STOPWORDS = new Set([
  "quais",
  "qual",
  "como",
  "onde",
  "quando",
  "hotel",
  "quarto",
  "quartos",
  "categoria",
  "categorias",
  "sobre",
  "para",
  "com",
  "dos",
  "das",
  "do",
  "da",
  "de",
  "em",
  "o",
  "a",
  "os",
  "as",
  "um",
  "uma",
  "meu",
  "minha",
  "seu",
  "sua",
  "tipo",
  "tipos",
]);

/** Tokens de estabelecimento/propriedade na consulta (ex.: «brooklin» em «hotel brooklin»). */
export function extractQueryEstablishmentTokens(normalizedQuery: string): string[] {
  const q = normalizedQuery.trim().toLowerCase();
  if (!q) return [];
  const tokens = new Set<string>();

  for (const m of q.matchAll(
    /\b(?:hotel|resort|pousada|suites?|inn|hostel)\s+([\p{L}0-9][\p{L}0-9\s-]{1,48})/giu,
  )) {
    const phrase = m[1]
      .trim()
      .replace(/\s+(do|da|de|dos|das|no|na|em)$/i, "")
      .trim();
    if (phrase.length >= 3) {
      tokens.add(phrase);
      for (const part of phrase.split(/\s+/).filter((p) => p.length >= 4 && !QUERY_ESTABLISHMENT_STOPWORDS.has(p))) {
        tokens.add(part);
      }
    }
  }

  for (const term of queryTerms(q)) {
    if (term.length >= 4 && !QUERY_ESTABLISHMENT_STOPWORDS.has(term)) tokens.add(term);
  }

  return [...tokens].filter((t) => t.length >= 3);
}

function extractDocumentEstablishmentNames(text: string): string[] {
  const names: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(
    /\b(?:hotel|resort|pousada|suites?|inn|hostel)\s+([\p{L}0-9][\p{L}0-9\s-]{2,40})/giu,
  )) {
    names.push(m[1].trim());
  }
  for (const m of text.match(/\b[\p{L}][\p{L}0-9]*(?:\s+[\p{L}][\p{L}0-9]*){1,4}\s+suites?\b/giu) ?? []) {
    names.push(m.trim().toLowerCase());
  }
  return [...new Set(names.filter((n) => n.length >= 3))];
}

/** Boost/penalização leve quando a consulta menciona um estabelecimento concreto (multi-hotel). */
export function applyQueryEntityRankingBoost<T extends { score: number }>(
  rows: T[],
  normalizedQuery: string,
  getHaystack: (row: T) => string,
): T[] {
  const queryTokens = extractQueryEstablishmentTokens(normalizedQuery);
  if (queryTokens.length === 0 || rows.length === 0) return rows;

  const matchesQueryEntity = (hay: string): boolean => queryTokens.some((t) => hay.includes(t));

  const boosted = rows.map((row) => {
    const hay = getHaystack(row).toLowerCase();
    let delta = 0;
    if (matchesQueryEntity(hay)) {
      delta += 0.22;
      const longest = queryTokens.reduce((a, b) => (a.length >= b.length ? a : b));
      if (longest.length >= 6 && hay.includes(longest)) delta += 0.12;
    }
    for (const docName of extractDocumentEstablishmentNames(hay)) {
      const docMatches = queryTokens.some((t) => docName.includes(t) || t.includes(docName));
      if (!docMatches && docName.length >= 4) delta -= 0.35;
    }
    return { ...row, score: Math.min(1, Math.max(0, row.score + delta)) };
  });

  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}
