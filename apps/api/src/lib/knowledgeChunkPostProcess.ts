import { applyQueryEntityRankingBoost } from "./knowledgeSearchRanking.js";
import { extractQueryTopicTerms, sectionSignature } from "./knowledgeQueryEnrichment.js";

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
    for (const term of terms) {
      if (hay.includes(term.toLowerCase())) delta += 0.12;
    }
    const headerMatch = chunk.text.match(/^#{2,3}\s+(.+)$/m);
    if (headerMatch) {
      const header = headerMatch[1].toLowerCase();
      if (terms.some((t) => header.includes(t) || t.includes(header))) delta += 0.25;
    }
    return { ...chunk, score: Math.min(1, chunk.score + delta) };
  });

  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}

/** Prefere excertos de secções distintas (WiFi, quartos, estacionamento…) em vez de repetir o mesmo bloco. */
export function diversifyKnowledgeChunks<T extends ScoredKnowledgeChunk>(
  chunks: T[],
  limit: number,
): T[] {
  if (chunks.length <= limit) return chunks;
  const out: T[] = [];
  const seenSections = new Set<string>();
  const seenDocs = new Set<string>();

  for (const chunk of chunks) {
    const sig = `${chunk.documentId ?? chunk.documentName ?? ""}:${sectionSignature(chunk.text)}`;
    if (seenSections.has(sig)) continue;
    seenSections.add(sig);
    if (chunk.documentId) seenDocs.add(chunk.documentId);
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

export function finalizeKnowledgeChunks<T extends ScoredKnowledgeChunk>(
  chunks: T[],
  query: string,
  opts: { limit: number; excerptMaxLen?: number },
): T[] {
  if (!chunks.length) return [];
  let processed = applyKnowledgeTopicBoost(chunks, query);
  processed = applyQueryEntityRankingBoost(processed, query.toLowerCase(), (c) =>
    `${c.documentName ?? ""} ${c.text}`,
  );
  processed = diversifyKnowledgeChunks(processed, opts.limit);
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

/** Pós-processamento de linhas ranked (path legado OpenNexo / buscar_conhecimento). */
export function postProcessRankedKnowledgeRows<
  T extends { score: number; excerpt: string; article: { id: string; title: string; content: string } },
>(ranked: T[], query: string, limit: number): T[] {
  if (!ranked.length) return [];
  const asChunks: ScoredKnowledgeChunk[] = ranked.map((r) => ({
    score: r.score,
    text: r.excerpt || r.article.content,
    documentId: r.article.id,
    documentName: r.article.title,
    excerpt: r.excerpt,
  }));
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
