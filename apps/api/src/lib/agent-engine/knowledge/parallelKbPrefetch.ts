import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import {
  formatRankedKnowledgeForSystemPrompt,
  rankedKnowledgeSearch,
  type RankedKnowledgeRow,
} from "../../knowledgeRetrieval.js";

export type KbPrefetchResult = {
  articleId: string;
  title: string;
  ranked: RankedKnowledgeRow[];
};

export async function prefetchKnowledgeForArticle(params: {
  organizationId: string;
  botId: string;
  articleId: string;
  normalizedQuery: string;
  log?: FastifyBaseLogger;
}): Promise<KbPrefetchResult | null> {
  const article = await prisma.automationKnowledgeArticle.findFirst({
    where: {
      id: params.articleId,
      organizationId: params.organizationId,
      isActive: true,
      syncToAi: true,
    },
  });
  if (!article) return null;

  const norm = params.normalizedQuery.trim().toLowerCase().slice(0, 500);
  let ranked: RankedKnowledgeRow[] = [];
  if (norm) {
    const search = await rankedKnowledgeSearch({
      organizationId: params.organizationId,
      normalizedQuery: norm,
      botId: params.botId,
      limit: 8,
      debugLog: params.log,
    });
    ranked = search.ranked.filter((r) => r.article.id === article.id);
  }
  if (!ranked.length) {
    ranked = [
      {
        article,
        score: 1,
        excerpt: article.content.slice(0, 2400),
      },
    ];
  }

  return {
    articleId: article.id,
    title: article.title,
    ranked: ranked.slice(0, 3),
  };
}

export function mergeKbPrefetchAppendix(results: KbPrefetchResult[]): string {
  const byArticle = new Map<string, RankedKnowledgeRow>();
  for (const row of results) {
    for (const ranked of row.ranked) {
      const prev = byArticle.get(ranked.article.id);
      if (!prev || ranked.score > prev.score) {
        byArticle.set(ranked.article.id, ranked);
      }
    }
  }
  const merged = [...byArticle.values()].sort((a, b) => b.score - a.score);
  if (!merged.length) return "";
  return formatRankedKnowledgeForSystemPrompt(merged);
}
