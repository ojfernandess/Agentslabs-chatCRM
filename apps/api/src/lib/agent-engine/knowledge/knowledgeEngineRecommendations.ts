import { prisma } from "../../../db.js";
import { chunkText } from "../../knowledgeChunking.js";
import { effectiveKnowledgeSearchBotId } from "../../knowledgeRetrieval.js";

export type KnowledgeEngineRecommendationStats = {
  documentCount: number;
  totalChars: number;
  avgDocChars: number;
  indexedChunkCount: number;
  estimatedChunkCount: number;
  scopedToBot: boolean;
};

export type KnowledgeEngineRecommendationResult = {
  maxDocuments: number;
  maxChunks: number;
  searchTemperature: number;
  chunkSize: number;
  chunkOverlap: number;
  stats: KnowledgeEngineRecommendationStats;
};

function roundChunkSize(n: number): number {
  return Math.min(4000, Math.max(200, Math.round(n / 50) * 50));
}

function recommendChunkSize(avgDocChars: number, totalChars: number): number {
  if (totalChars <= 0) return 900;
  if (avgDocChars < 1200) return roundChunkSize(650);
  if (avgDocChars < 3500) return roundChunkSize(900);
  if (avgDocChars < 12000) return roundChunkSize(1200);
  if (avgDocChars < 30000) return roundChunkSize(1600);
  return roundChunkSize(2000);
}

function recommendOverlap(chunkSize: number): number {
  return Math.min(800, Math.max(40, Math.round(chunkSize * 0.13)));
}

/**
 * Analisa a KB da organização (opcionalmente scoped ao bot) e sugere limites
 * para recuperar o máximo de contexto útil sem cortar documentos relevantes.
 */
export async function computeKnowledgeEngineRecommendations(input: {
  organizationId: string;
  botId?: string;
}): Promise<KnowledgeEngineRecommendationResult> {
  const scopedBotId = input.botId
    ? await effectiveKnowledgeSearchBotId(input.organizationId, input.botId)
    : undefined;

  const articles = await prisma.automationKnowledgeArticle.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      syncToAi: true,
      ...(scopedBotId ? { botLinks: { some: { botId: scopedBotId } } } : {}),
    },
    select: { id: true, content: true },
  });

  const documentCount = articles.length;
  const totalChars = articles.reduce((sum, a) => sum + a.content.length, 0);
  const avgDocChars = documentCount > 0 ? Math.round(totalChars / documentCount) : 0;

  const indexedChunkCount = await prisma.automationKnowledgeChunk.count({
    where: {
      article: {
        organizationId: input.organizationId,
        isActive: true,
        syncToAi: true,
        ...(scopedBotId ? { botLinks: { some: { botId: scopedBotId } } } : {}),
      },
    },
  });

  const chunkSize = recommendChunkSize(avgDocChars, totalChars);
  const chunkOverlap = recommendOverlap(chunkSize);

  let estimatedChunkCount = 0;
  for (const article of articles) {
    estimatedChunkCount += chunkText(article.content, chunkSize, chunkOverlap).length;
  }
  if (estimatedChunkCount === 0 && documentCount > 0) {
    estimatedChunkCount = documentCount;
  }

  const chunkTarget = Math.max(indexedChunkCount, estimatedChunkCount, documentCount, 1);
  const maxDocuments = Math.min(50, Math.max(1, documentCount || 1));
  const maxChunks = Math.min(100, Math.max(maxDocuments, chunkTarget));

  return {
    maxDocuments,
    maxChunks,
    searchTemperature: 0,
    chunkSize,
    chunkOverlap,
    stats: {
      documentCount,
      totalChars,
      avgDocChars,
      indexedChunkCount,
      estimatedChunkCount,
      scopedToBot: Boolean(scopedBotId),
    },
  };
}

export function applyKnowledgeEngineRecommendations<T extends {
  maxDocuments: number;
  maxChunks: number;
  searchTemperature: number;
  chunking: { chunkSize: number; chunkOverlap: number };
}>(base: T, rec: KnowledgeEngineRecommendationResult): T {
  return {
    ...base,
    maxDocuments: rec.maxDocuments,
    maxChunks: rec.maxChunks,
    searchTemperature: rec.searchTemperature,
    chunking: {
      ...base.chunking,
      chunkSize: rec.chunkSize,
      chunkOverlap: rec.chunkOverlap,
    },
  };
}
