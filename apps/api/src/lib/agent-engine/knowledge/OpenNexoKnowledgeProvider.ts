import type {
  RankedKnowledgeRow,
} from "../../knowledgeRetrieval.js";
import {
  fetchProactiveKnowledgeSystemAppendix,
  formatRankedKnowledgeForSystemPrompt,
  mergeBotLinkedKnowledgeWhenRankedEmpty,
  mergePinnedKnowledgeWhenRankedEmpty,
  rankedKnowledgeSearch,
} from "../../knowledgeRetrieval.js";
import { reindexKnowledgeArticle, reindexAllKnowledgeArticlesForOrg } from "../../knowledgeReindex.js";
import {
  adaptiveKnowledgeMinScore,
  postProcessRankedKnowledgeRows,
} from "../../knowledgeChunkPostProcess.js";
import { prisma } from "../../../db.js";
import type {
  KnowledgeChunk,
  KnowledgeCitation,
  KnowledgeClearInput,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeDocumentRemoveInput,
  KnowledgeDocumentUpdateInput,
  KnowledgeEngineConfig,
  KnowledgeIndexInput,
  KnowledgeIndexResult,
  KnowledgeListInput,
  KnowledgeProviderKind,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  KnowledgeRerankInput,
  KnowledgeRerankResult,
  KnowledgeRetrieveInput,
  KnowledgeSearchInput,
} from "./knowledgeEngineTypes.js";

function mapRankedToChunks(ranked: RankedKnowledgeRow[]): KnowledgeChunk[] {
  return ranked.map((row, idx) => ({
    id: `${row.article.id}:${idx}`,
    documentId: row.article.id,
    documentName: row.article.title,
    text: row.excerpt,
    score: row.score,
    similarity: row.score,
    metadata: { chunkIndex: idx },
    excerpt: row.excerpt,
  }));
}

function mapRankedToCitations(
  ranked: RankedKnowledgeRow[],
  includeCitations: boolean,
): KnowledgeCitation[] {
  if (!includeCitations) return [];
  return ranked.map((row) => ({
    documentId: row.article.id,
    documentName: row.article.title,
    excerpt: row.excerpt,
    origin: row.article.category,
    link: null,
    score: row.score,
  }));
}

async function searchRanked(input: {
  organizationId: string;
  botId?: string;
  query: string;
  limit: number;
  pinnedArticleIds?: string[];
}): Promise<RankedKnowledgeRow[]> {
  const norm = input.query.trim().toLowerCase().slice(0, 500);
  if (!norm) return [];
  let { ranked } = await rankedKnowledgeSearch({
    organizationId: input.organizationId,
    normalizedQuery: norm,
    botId: input.botId,
    limit: input.limit,
  });
  ranked = await mergePinnedKnowledgeWhenRankedEmpty({
    organizationId: input.organizationId,
    ranked,
    pinnedArticleIds: input.pinnedArticleIds,
  });
  ranked = await mergeBotLinkedKnowledgeWhenRankedEmpty({
    organizationId: input.organizationId,
    botId: input.botId ?? "",
    ranked,
  });
  return ranked;
}

function rerankChunks(input: KnowledgeRerankInput): KnowledgeRerankResult {
  const q = input.query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length >= 3);
  const scored = input.chunks.map((chunk) => {
    let boost = chunk.score;
    const hay = `${chunk.documentName} ${chunk.text}`.toLowerCase();
    for (const term of terms) {
      if (hay.includes(term)) boost += 0.08;
    }
    return { ...chunk, score: Math.min(1, boost) };
  });
  scored.sort((a, b) => b.score - a.score);
  return { chunks: scored.slice(0, input.topK ?? scored.length) };
}

async function articleToDocument(row: {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  _count?: { chunks: number };
}): Promise<KnowledgeDocument> {
  const tokenEstimate = Math.ceil(row.content.length / 4);
  return {
    id: row.id,
    name: row.title,
    category: row.category,
    description: row.content.slice(0, 240),
    origin: null,
    author: null,
    organizationId: row.organizationId,
    tags: row.tags,
    language: "pt",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    chunkCount: row._count?.chunks ?? 0,
    tokenEstimate,
    version: Math.floor(row.updatedAt.getTime() / 1000),
    status: row.isActive ? "active" : "archived",
  };
}

/** Implementação OpenNexo — delega ao pipeline RAG legado (pgvector + lexical). */
export class OpenNexoKnowledgeProvider {
  readonly kind: KnowledgeProviderKind = "openconduit";

  async index(input: KnowledgeIndexInput): Promise<KnowledgeIndexResult> {
    if (input.documentId) {
      const result = await reindexKnowledgeArticle(input.documentId);
      if ("skipped" in result && result.skipped) {
        return { indexed: 0, skipped: 1, chunks: 0, errors: [result.reason] };
      }
      return { indexed: 1, skipped: 0, chunks: result.chunks, errors: [] };
    }
    const bulk = await reindexAllKnowledgeArticlesForOrg(input.organizationId);
    return {
      indexed: bulk.articlesIndexed,
      skipped: bulk.articlesSkipped,
      chunks: bulk.chunksTotal,
      errors: bulk.errors > 0 ? [`${bulk.errors} artigos falharam na reindexação`] : [],
    };
  }

  async query(input: KnowledgeQueryInput, config: KnowledgeEngineConfig): Promise<KnowledgeQueryResult> {
    return this.retrieve({ ...input, maxDocuments: config.maxDocuments, maxChunks: config.maxChunks }, config);
  }

  async search(input: KnowledgeSearchInput, config: KnowledgeEngineConfig): Promise<KnowledgeQueryResult> {
    return this.query(input, config);
  }

  async retrieve(input: KnowledgeRetrieveInput, config: KnowledgeEngineConfig): Promise<KnowledgeQueryResult> {
    const started = Date.now();
    const limit = Math.min(input.maxChunks ?? config.maxChunks, config.maxChunks);
    const ranked = await searchRanked({
      organizationId: input.organizationId,
      botId: input.botId,
      query: input.query,
      limit,
      pinnedArticleIds: input.pinnedArticleIds,
    });
    const filtered = ranked.filter(
      (r) => r.score >= adaptiveKnowledgeMinScore(input.query, config.minScore, config.minSimilarity),
    );
    const postRanked = postProcessRankedKnowledgeRows(filtered, input.query, limit);
    let chunks = mapRankedToChunks(postRanked);
    if (config.reranking) {
      chunks = rerankChunks({ query: input.query, chunks, topK: limit }).chunks;
    }
    const appendix = formatRankedKnowledgeForSystemPrompt(
      postRanked.slice(0, input.maxDocuments ?? config.maxDocuments),
    );
    const docIds = new Set(chunks.map((c) => c.documentId));
    const documents: KnowledgeDocument[] = [];
    if (docIds.size > 0) {
      const rows = await prisma.automationKnowledgeArticle.findMany({
        where: { organizationId: input.organizationId, id: { in: [...docIds] } },
        include: { _count: { select: { chunks: true } } },
      });
      for (const row of rows) documents.push(await articleToDocument(row));
    }
    return {
      documents,
      chunks,
      appendix,
      citations: mapRankedToCitations(postRanked, config.citations),
      latencyMs: Date.now() - started,
      provider: this.kind,
      fromCache: false,
    };
  }

  async rerank(input: KnowledgeRerankInput): Promise<KnowledgeRerankResult> {
    return rerankChunks(input);
  }

  async addDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocument> {
    const row = await prisma.automationKnowledgeArticle.create({
      data: {
        organizationId: input.organizationId,
        title: input.name.trim(),
        content: input.content,
        category: input.category ?? null,
        tags: input.tags ?? [],
        isActive: true,
        syncToAi: true,
        ...(input.botIds?.length
          ? { botLinks: { create: input.botIds.map((botId) => ({ botId })) } }
          : {}),
      },
      include: { _count: { select: { chunks: true } } },
    });
    await reindexKnowledgeArticle(row.id);
    return articleToDocument(row);
  }

  async removeDocument(input: KnowledgeDocumentRemoveInput): Promise<boolean> {
    const deleted = await prisma.automationKnowledgeArticle.deleteMany({
      where: { id: input.documentId, organizationId: input.organizationId },
    });
    return deleted.count > 0;
  }

  async updateDocument(input: KnowledgeDocumentUpdateInput): Promise<KnowledgeDocument | null> {
    const existing = await prisma.automationKnowledgeArticle.findFirst({
      where: { id: input.documentId, organizationId: input.organizationId },
    });
    if (!existing) return null;
    const row = await prisma.automationKnowledgeArticle.update({
      where: { id: input.documentId },
      data: {
        ...(input.patch.name ? { title: input.patch.name.trim() } : {}),
        ...(input.patch.content ? { content: input.patch.content } : {}),
        ...(input.patch.category !== undefined ? { category: input.patch.category } : {}),
        ...(input.patch.tags ? { tags: input.patch.tags } : {}),
      },
      include: { _count: { select: { chunks: true } } },
    });
    if (input.patch.content) await reindexKnowledgeArticle(row.id);
    return articleToDocument(row);
  }

  async listDocuments(input: KnowledgeListInput): Promise<KnowledgeDocument[]> {
    const rows = await prisma.automationKnowledgeArticle.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.category ? { category: input.category } : {}),
        ...(input.botId ? { botLinks: { some: { botId: input.botId } } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit ?? 50,
      include: { _count: { select: { chunks: true } } },
    });
    return Promise.all(rows.map((r) => articleToDocument(r)));
  }

  async clearIndex(input: KnowledgeClearInput): Promise<number> {
    if (input.documentId) {
      await prisma.automationKnowledgeChunk.deleteMany({
        where: { articleId: input.documentId, article: { organizationId: input.organizationId } },
      });
      return 1;
    }
    const res = await prisma.automationKnowledgeChunk.deleteMany({
      where: { article: { organizationId: input.organizationId } },
    });
    return res.count;
  }

  async buildProactiveAppendix(input: {
    organizationId: string;
    botId: string;
    userMessage: string;
    pinnedArticleIds?: string[];
    limit?: number;
    config: KnowledgeEngineConfig;
  }): Promise<KnowledgeQueryResult> {
    const started = Date.now();
    const legacyAppendix = await fetchProactiveKnowledgeSystemAppendix({
      organizationId: input.organizationId,
      botId: input.botId,
      userMessage: input.userMessage,
      pinnedArticleIds: input.pinnedArticleIds,
      limit: input.limit ?? input.config.maxDocuments,
    });
    return {
      documents: [],
      chunks: [],
      appendix: legacyAppendix,
      citations: [],
      latencyMs: Date.now() - started,
      provider: this.kind,
      fromCache: false,
    };
  }

  formatToolResult(chunks: KnowledgeChunk[]): string {
    if (!chunks.length) {
      return JSON.stringify({ found: false, message: "Nenhum artigo relevante na base de conhecimento." });
    }
    const items = chunks.slice(0, 6).map((c) => ({
      id: c.documentId,
      title: c.documentName,
      excerpt: c.excerpt,
      score: Math.round(c.score * 1000) / 1000,
    }));
    return JSON.stringify({ found: true, articles: items });
  }
}
