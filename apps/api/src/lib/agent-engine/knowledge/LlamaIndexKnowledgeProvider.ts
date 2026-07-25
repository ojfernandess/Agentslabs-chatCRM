import { prisma } from "../../../db.js";
import type {
  KnowledgeEngineConfig,
  KnowledgeIndexInput,
  KnowledgeIndexResult,
  KnowledgeProviderKind,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  KnowledgeRerankInput,
  KnowledgeRerankResult,
  KnowledgeRetrieveInput,
  KnowledgeSearchInput,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeDocumentRemoveInput,
  KnowledgeDocumentUpdateInput,
  KnowledgeListInput,
  KnowledgeClearInput,
} from "./knowledgeEngineTypes.js";
import { OpenNexoKnowledgeProvider } from "./OpenNexoKnowledgeProvider.js";
import { effectiveKnowledgeSearchBotId } from "../../knowledgeRetrieval.js";
import { applyQueryEntityRankingBoost } from "../../knowledgeSearchRanking.js";
import {
  adaptiveKnowledgeMinScore,
  enrichKnowledgeChunksWithArticleSections,
  finalizeKnowledgeChunks,
} from "../../knowledgeChunkPostProcess.js";

type LlamaDocument = {
  id_: string;
  text: string;
  metadata: Record<string, unknown>;
};

function extractNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; getContent?: (mode: string) => string };
  if (typeof n.text === "string" && n.text.length > 0) return n.text;
  if (typeof n.getContent === "function") {
    try {
      return n.getContent("none");
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * LlamaIndex Knowledge Provider — usa a biblioteca oficial internamente.
 * Indexação persiste via pipeline OpenNexo (pgvector); retrieve usa VectorStoreIndex em memória.
 */
export class LlamaIndexKnowledgeProvider {
  readonly kind: KnowledgeProviderKind = "llamaindex";
  private readonly legacy = new OpenNexoKnowledgeProvider();
  private indexCache = new Map<string, { builtAt: number; chunkCount: number }>();

  async index(input: KnowledgeIndexInput): Promise<KnowledgeIndexResult> {
    const result = await this.legacy.index(input);
    this.indexCache.delete(input.organizationId);
    return result;
  }

  private async loadDocuments(organizationId: string, botId?: string): Promise<LlamaDocument[]> {
    const scopedBotId = botId
      ? await effectiveKnowledgeSearchBotId(organizationId, botId)
      : undefined;
    const chunks = await prisma.automationKnowledgeChunk.findMany({
      where: {
        article: {
          organizationId,
          isActive: true,
          syncToAi: true,
          ...(scopedBotId ? { botLinks: { some: { botId: scopedBotId } } } : {}),
        },
      },
      include: { article: { select: { id: true, title: true, category: true } } },
      take: 500,
      orderBy: { chunkIndex: "asc" },
    });
    return chunks.map((row) => ({
      id_: `${row.articleId}:${row.chunkIndex}`,
      text: row.text,
      metadata: {
        documentId: row.articleId,
        documentName: row.article.title,
        category: row.article.category,
        chunkIndex: row.chunkIndex,
      },
    }));
  }

  private async retrieveWithLlamaIndex(
    input: KnowledgeRetrieveInput,
    cfg: KnowledgeEngineConfig,
  ): Promise<KnowledgeQueryResult | null> {
    try {
      const { Document, VectorStoreIndex, Settings } = await import("llamaindex");
      const apiKey = process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_PROMPT_PREVIEW_KEY?.trim();
      if (!apiKey) return null;

      const { OpenAIEmbedding } = await import("@llamaindex/openai");
      // Evita conflito de versões @llamaindex/core entre pacotes top-level e nested.
      Settings.embedModel = new OpenAIEmbedding({
        model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        apiKey,
      }) as (typeof Settings)["embedModel"];

      const cacheKey = `${input.organizationId}:${input.botId ?? "all"}`;
      const sourceDocs = await this.loadDocuments(input.organizationId, input.botId);
      if (sourceDocs.length === 0) return null;

      this.indexCache.set(cacheKey, { builtAt: Date.now(), chunkCount: sourceDocs.length });

      const llamaDocs = sourceDocs.map(
        (d) =>
          new Document({
            id_: d.id_,
            text: d.text,
            metadata: d.metadata,
          }),
      );
      const index = await VectorStoreIndex.fromDocuments(llamaDocs);
      const retriever = index.asRetriever({ similarityTopK: cfg.maxChunks });
      const nodes = await retriever.retrieve({ query: input.query });

      let knowledgeChunks: KnowledgeChunk[] = nodes.map((node, idx) => {
        const meta = (node.node.metadata ?? {}) as Record<string, unknown>;
        const score = typeof node.score === "number" ? node.score : 0.5;
        const text = extractNodeText(node.node);
        return {
          id: String((node.node as { id_?: string }).id_ ?? idx),
          documentId: String(meta.documentId ?? ""),
          documentName: String(meta.documentName ?? "Documento"),
          text,
          score,
          similarity: score,
          metadata: { chunkIndex: Number(meta.chunkIndex ?? idx) },
          excerpt: text.length > 320 ? `${text.slice(0, 320)}…` : text,
        };
      });

      knowledgeChunks = knowledgeChunks.filter(
        (c) => c.score >= adaptiveKnowledgeMinScore(input.query, cfg.minScore, cfg.minSimilarity),
      );

      knowledgeChunks = finalizeKnowledgeChunks(knowledgeChunks, input.query, {
        limit: cfg.maxChunks,
        excerptMaxLen: 720,
      });

      knowledgeChunks = await enrichKnowledgeChunksWithArticleSections(
        knowledgeChunks,
        input.query,
        input.organizationId,
        cfg.maxChunks,
      );

      if (cfg.reranking && knowledgeChunks.length > 1) {
        knowledgeChunks = (
          await this.rerank({ query: input.query, chunks: knowledgeChunks, topK: cfg.maxChunks })
        ).chunks;
      }

      const appendixParts = knowledgeChunks.slice(0, cfg.maxDocuments).map((c, i) => {
        const sc = Math.round(c.score * 1000) / 1000;
        return `**${i + 1}. ${c.documentName}** (LlamaIndex relevância ${sc})\n${c.excerpt}`;
      });

      const appendix =
        appendixParts.length > 0
          ? "\n\n### Base de conhecimento (LlamaIndex)\n" + appendixParts.join("\n\n")
          : "";

      const docIds = [...new Set(knowledgeChunks.map((c) => c.documentId).filter(Boolean))];
      const knowledgeDocuments: KnowledgeDocument[] =
        docIds.length > 0
          ? await this.legacy.listDocuments({ organizationId: input.organizationId, limit: docIds.length })
          : [];

      return {
        documents: knowledgeDocuments.filter((d) => docIds.includes(d.id)),
        chunks: knowledgeChunks,
        appendix,
        citations: cfg.citations
          ? knowledgeChunks.map((c) => ({
              documentId: c.documentId,
              documentName: c.documentName,
              excerpt: c.excerpt,
              score: c.score,
              origin: "llamaindex",
            }))
          : [],
        latencyMs: 0,
        provider: this.kind,
        fromCache: false,
      };
    } catch {
      return null;
    }
  }

  async query(input: KnowledgeQueryInput, cfg: KnowledgeEngineConfig): Promise<KnowledgeQueryResult> {
    return this.retrieve({ ...input, maxDocuments: cfg.maxDocuments, maxChunks: cfg.maxChunks }, cfg);
  }

  async search(input: KnowledgeSearchInput, cfg: KnowledgeEngineConfig): Promise<KnowledgeQueryResult> {
    return this.query(input, cfg);
  }

  async retrieve(input: KnowledgeRetrieveInput, cfg: KnowledgeEngineConfig): Promise<KnowledgeQueryResult> {
    const started = Date.now();
    const llama = await this.retrieveWithLlamaIndex(input, cfg);
    if (llama) {
      return { ...llama, latencyMs: Date.now() - started };
    }
    const fallback = await this.legacy.retrieve(input, cfg);
    return { ...fallback, provider: this.kind, latencyMs: Date.now() - started };
  }

  async rerank(input: KnowledgeRerankInput): Promise<KnowledgeRerankResult> {
    return this.legacy.rerank(input);
  }

  async addDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocument> {
    this.indexCache.delete(input.organizationId);
    return this.legacy.addDocument(input);
  }

  async removeDocument(input: KnowledgeDocumentRemoveInput): Promise<boolean> {
    this.indexCache.delete(input.organizationId);
    return this.legacy.removeDocument(input);
  }

  async updateDocument(input: KnowledgeDocumentUpdateInput): Promise<KnowledgeDocument | null> {
    this.indexCache.delete(input.organizationId);
    return this.legacy.updateDocument(input);
  }

  async listDocuments(input: KnowledgeListInput): Promise<KnowledgeDocument[]> {
    return this.legacy.listDocuments(input);
  }

  async clearIndex(input: KnowledgeClearInput): Promise<number> {
    if (input.organizationId) this.indexCache.delete(input.organizationId);
    return this.legacy.clearIndex(input);
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
    const result = await this.retrieve(
      {
        organizationId: input.organizationId,
        botId: input.botId,
        query: input.userMessage,
        pinnedArticleIds: input.pinnedArticleIds,
        maxDocuments: input.limit ?? input.config.maxDocuments,
        maxChunks: input.config.maxChunks,
      },
      input.config,
    );
    return { ...result, latencyMs: Date.now() - started, provider: this.kind };
  }

  formatToolResult(chunks: KnowledgeChunk[]): string {
    return this.legacy.formatToolResult(chunks);
  }
}
