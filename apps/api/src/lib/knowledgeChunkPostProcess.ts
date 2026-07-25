import { applyQueryEntityRankingBoost } from "./knowledgeSearchRanking.js";
import {
  chunkMatchesQueryTopics,
  extractQueryTopicTerms,
  isKnowledgeOverviewChunk,
  knowledgeContentCoversQuery,
  sectionSignature,
} from "./knowledgeQueryEnrichment.js";
import {
  extractMarkdownSectionForQuery,
  hasSubstantiveChunkBody,
} from "./knowledgeMarkdownChunking.js";

export type ScoredKnowledgeChunk = {
  score: number;
  text: string;
  documentId?: string;
  documentName?: string;
  excerpt?: string;
};

/** Excerpt centrado nos termos da query (SSID, secção WiFi, etc.). */
export function buildQueryCenteredExcerpt(text: string, query: string, maxLen = 720): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;

  const terms = extractQueryTopicTerms(query);
  const lower = t.toLowerCase();
  let bestIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }

  if (bestIdx < 0) {
    const headerIdx = lower.search(/^#{2,3}\s/m);
    if (headerIdx >= 0) bestIdx = headerIdx;
  }

  if (bestIdx < 0) return t.slice(0, maxLen) + (t.length > maxLen ? "…" : "");

  const start = Math.max(0, bestIdx - 120);
  const slice = t.slice(start, start + maxLen);
  return (start > 0 ? "…" : "") + slice + (start + maxLen < t.length ? "…" : "");
}

export function applyKnowledgeTopicBoost<T extends ScoredKnowledgeChunk>(
  chunks: T[],
  query: string,
): T[] {
  const terms = extractQueryTopicTerms(query);
  if (!terms.length) return chunks;

  const boosted = chunks.map((chunk) => {
    const hay = `${chunk.documentName ?? ""} ${chunk.text}`.toLowerCase();
    let delta = 0;
    if (isKnowledgeOverviewChunk(chunk.text)) delta -= 0.35;
    for (const term of terms) {
      if (hay.includes(term.toLowerCase())) delta += 0.12;
    }
    const headerMatch = chunk.text.match(/^#{2,3}\s+(.+)$/m);
    if (headerMatch) {
      const header = headerMatch[1].toLowerCase();
      if (terms.some((t) => header.includes(t) || t.includes(header.split("/")[0]?.trim() ?? ""))) delta += 0.35;
    }
    return { ...chunk, score: Math.min(1, Math.max(0, chunk.score + delta)) };
  });

  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}

function dedupeSections<T extends ScoredKnowledgeChunk>(chunks: T[], limit: number): T[] {
  const out: T[] = [];
  const seenSections = new Set<string>();

  for (const chunk of chunks) {
    const sig = `${chunk.documentId ?? chunk.documentName ?? ""}:${sectionSignature(chunk.text)}`;
    if (seenSections.has(sig)) continue;
    seenSections.add(sig);
    out.push(chunk);
    if (out.length >= limit) break;
  }

  if (out.length < limit) {
    for (const chunk of chunks) {
      if (out.includes(chunk)) continue;
      out.push(chunk);
      if (out.length >= limit) break;
    }
  }

  return out;
}

/** Prefere excertos de secções distintas; com query, prioriza secções que respondem ao tópico. */
export function diversifyKnowledgeChunks<T extends ScoredKnowledgeChunk>(
  chunks: T[],
  limit: number,
  query?: string,
): T[] {
  if (chunks.length <= limit) return chunks;

  const q = query?.trim() ?? "";
  if (q) {
    const onTopic = chunks.filter((c) => chunkMatchesQueryTopics(c.text, q));
    if (onTopic.length > 0) {
      return dedupeSections(onTopic, limit);
    }
  }

  return dedupeSections(chunks, limit);
}

export function finalizeKnowledgeChunks<T extends ScoredKnowledgeChunk>(
  chunks: T[],
  query: string,
  opts: { limit: number; excerptMaxLen?: number },
): T[] {
  if (!chunks.length) return [];
  const substantive = chunks.filter((c) => hasSubstantiveChunkBody(c.text) && !isKnowledgeOverviewChunk(c.text));
  let processed = applyKnowledgeTopicBoost(substantive.length > 0 ? substantive : chunks, query);
  processed = applyQueryEntityRankingBoost(processed, query.toLowerCase(), (c) =>
    `${c.documentName ?? ""} ${c.text}`,
  );
  processed = diversifyKnowledgeChunks(processed, opts.limit, query);
  const excerptMaxLen = opts.excerptMaxLen ?? 720;
  return processed.map((c) => ({
    ...c,
    excerpt: buildQueryCenteredExcerpt(c.text, query, excerptMaxLen),
  }));
}

export function adaptiveKnowledgeMinScore(query: string, minScore: number, minSimilarity: number): number {
  const q = query.trim();
  const terms = extractQueryTopicTerms(q);
  const isShortFactual = q.length <= 48 && terms.length <= 4;
  if (isShortFactual) return Math.min(minScore, minSimilarity, 0.15);
  return Math.max(minScore, minSimilarity);
}

function resolveChunkTextForQuery(
  excerpt: string,
  fullContent: string,
  query: string,
): string {
  let text = excerpt || fullContent;
  const sectionFromDoc = extractMarkdownSectionForQuery(fullContent, query);
  const overview = isKnowledgeOverviewChunk(text);
  const covers = query.trim() ? knowledgeContentCoversQuery(text, query) : hasSubstantiveChunkBody(text);

  if (hasSubstantiveChunkBody(sectionFromDoc)) {
    if (overview || !covers) text = sectionFromDoc;
  } else if (!hasSubstantiveChunkBody(text) && hasSubstantiveChunkBody(sectionFromDoc)) {
    text = sectionFromDoc;
  }

  return text;
}

/** Pós-processamento de linhas ranked (path legado OpenNexo / buscar_conhecimento). */
export function postProcessRankedKnowledgeRows<
  T extends { score: number; excerpt: string; article: { id: string; title: string; content: string } },
>(ranked: T[], query: string, limit: number): T[] {
  if (!ranked.length) return [];
  const asChunks: ScoredKnowledgeChunk[] = ranked.map((r) => {
    const text = resolveChunkTextForQuery(r.excerpt || "", r.article.content, query);
    return {
      score: r.score,
      text,
      documentId: r.article.id,
      documentName: r.article.title,
      excerpt: r.excerpt,
    };
  });
  const finalized = finalizeKnowledgeChunks(asChunks, query, { limit, excerptMaxLen: 720 });
  const byDoc = new Map(ranked.map((r) => [r.article.id, r]));
  return finalized.map((c) => {
    const source = byDoc.get(c.documentId ?? "") ?? ranked[0]!;
    return {
      ...source,
      score: c.score,
      excerpt: c.excerpt ?? c.text,
    };
  });
}
