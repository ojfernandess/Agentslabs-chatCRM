import { prisma } from "../db.js";
import { config } from "../config.js";
import { queryTerms, rankArticles } from "./knowledgeSearchRanking.js";
import { rankedSemanticKnowledgeSearch } from "./knowledgeSemanticSearch.js";

export type RankedKnowledgeRow = {
  article: {
    id: string;
    title: string;
    content: string;
    category: string | null;
    tags: string[];
    isActive: boolean;
    syncToAi: boolean;
    createdAt: Date;
    updatedAt: Date;
    organizationId: string;
  };
  score: number;
  excerpt: string;
};

export async function rankedLexicalKnowledgeSearch(params: {
  organizationId: string;
  normalizedQuery: string;
  botId: string | undefined;
  limit: number;
}): Promise<RankedKnowledgeRow[]> {
  const { organizationId, normalizedQuery: norm, botId, limit } = params;
  const terms = queryTerms(norm);
  const orClause =
    terms.length > 0
      ? terms.flatMap((term) => [
          { title: { contains: term, mode: "insensitive" as const } },
          { content: { contains: term, mode: "insensitive" as const } },
        ])
      : [
          { title: { contains: norm, mode: "insensitive" as const } },
          { content: { contains: norm, mode: "insensitive" as const } },
        ];

  const whereBase = {
    organizationId,
    isActive: true,
    syncToAi: true,
    OR: orClause,
  };
  const where = botId != null ? { ...whereBase, botLinks: { some: { botId } } } : whereBase;

  let candidates = await prisma.automationKnowledgeArticle.findMany({
    where,
    take: 160,
  });

  if (candidates.length === 0 && terms.length > 1) {
    const fbBase = {
      organizationId,
      isActive: true,
      syncToAi: true,
      OR: [
        { title: { contains: norm, mode: "insensitive" as const } },
        { content: { contains: norm, mode: "insensitive" as const } },
      ],
    };
    const fbWhere = botId != null ? { ...fbBase, botLinks: { some: { botId } } } : fbBase;
    candidates = await prisma.automationKnowledgeArticle.findMany({ where: fbWhere, take: 160 });
  }

  const ranked = rankArticles(candidates, norm);
  return ranked.slice(0, limit).map((r) => ({
    article: r.article,
    score: r.score,
    excerpt: r.excerpt,
  }));
}

/**
 * Pesquisa na base de conhecimento (semântica + lexical), mesma lógica usada no painel de automação.
 */
export async function rankedKnowledgeSearch(params: {
  organizationId: string;
  normalizedQuery: string;
  botId: string | undefined;
  limit: number;
}): Promise<{ ranked: RankedKnowledgeRow[]; mode: "lexical" | "semantic" | "hybrid" }> {
  const { organizationId, normalizedQuery: norm, botId, limit } = params;
  const hasKey = Boolean(config.openAiPromptPreviewKey);
  const chunkCount = hasKey
    ? await prisma.automationKnowledgeChunk.count({ where: { organizationId } })
    : 0;

  let semantic: RankedKnowledgeRow[] = [];
  if (hasKey && chunkCount > 0) {
    try {
      semantic = await rankedSemanticKnowledgeSearch({
        organizationId,
        normalizedQuery: norm,
        botId,
        limit: Math.max(limit, 14),
        apiKey: config.openAiPromptPreviewKey,
        embeddingModel: config.openAiEmbeddingModel,
      });
    } catch {
      semantic = [];
    }
  }

  const lexical = await rankedLexicalKnowledgeSearch(params);

  if (!semantic.length) {
    return { ranked: lexical.slice(0, limit), mode: "lexical" };
  }

  const semTop = semantic.slice(0, limit);
  const seen = new Set(semTop.map((r) => r.article.id));
  const merged: RankedKnowledgeRow[] = [...semTop];
  for (const r of lexical) {
    if (merged.length >= limit) break;
    if (!seen.has(r.article.id)) {
      seen.add(r.article.id);
      merged.push({
        ...r,
        score: Math.min(0.995, r.score * 0.42),
      });
    }
  }

  const mode: "semantic" | "hybrid" = merged.length > semTop.length ? "hybrid" : "semantic";
  return { ranked: merged.slice(0, limit), mode };
}
