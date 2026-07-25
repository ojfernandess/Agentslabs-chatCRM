import type {
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
  KnowledgeChunk,
} from "./knowledgeEngineTypes.js";
import { OpenNexoKnowledgeProvider } from "./OpenNexoKnowledgeProvider.js";
import { LlamaIndexKnowledgeProvider } from "./LlamaIndexKnowledgeProvider.js";
import {
  buildKnowledgeQueryCacheKey,
  getCachedQuery,
  setCachedQuery,
} from "./knowledgeCache.js";
import { buildKnowledgeQueryEvent } from "./KnowledgeObservability.js";
import { kbAppendixHasRetrievedExcerpts } from "../../kbAppendix.js";

/** Interface única do OpenNexo Knowledge Engine. */
export interface KnowledgeProvider {
  readonly kind: KnowledgeProviderKind;
  index(input: KnowledgeIndexInput): Promise<KnowledgeIndexResult>;
  query(input: KnowledgeQueryInput, config: KnowledgeEngineConfig): Promise<KnowledgeQueryResult>;
  search(input: KnowledgeSearchInput, config: KnowledgeEngineConfig): Promise<KnowledgeQueryResult>;
  retrieve(input: KnowledgeRetrieveInput, config: KnowledgeEngineConfig): Promise<KnowledgeQueryResult>;
  rerank(input: KnowledgeRerankInput): Promise<KnowledgeRerankResult>;
  addDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocument>;
  removeDocument(input: KnowledgeDocumentRemoveInput): Promise<boolean>;
  updateDocument(input: KnowledgeDocumentUpdateInput): Promise<KnowledgeDocument | null>;
  listDocuments(input: KnowledgeListInput): Promise<KnowledgeDocument[]>;
  clearIndex(input: KnowledgeClearInput): Promise<number>;
  buildProactiveAppendix(input: {
    organizationId: string;
    botId: string;
    userMessage: string;
    pinnedArticleIds?: string[];
    limit?: number;
    config: KnowledgeEngineConfig;
  }): Promise<KnowledgeQueryResult>;
  formatToolResult(chunks: KnowledgeChunk[]): string;
}

export function createKnowledgeProvider(kind: KnowledgeProviderKind): KnowledgeProvider {
  if (kind === "llamaindex") return new LlamaIndexKnowledgeProvider();
  return new OpenNexoKnowledgeProvider();
}

/** Fachada DI — ponto de entrada para runtimes e agentes. */
export class KnowledgeEngineService {
  constructor(
    private readonly provider: KnowledgeProvider,
    private readonly config: KnowledgeEngineConfig,
  ) {}

  static fromConfig(config: KnowledgeEngineConfig): KnowledgeEngineService {
    return new KnowledgeEngineService(createKnowledgeProvider(config.provider), config);
  }

  get providerKind(): KnowledgeProviderKind {
    return this.provider.kind;
  }

  get delegate(): KnowledgeProvider {
    return this.provider;
  }

  async buildProactiveAppendix(input: {
    organizationId: string;
    botId: string;
    userMessage: string;
    pinnedArticleIds?: string[];
    limit?: number;
    cacheEnabled?: boolean;
  }): Promise<{ appendix: string; result: KnowledgeQueryResult; hasUsefulExcerpts: boolean }> {
    if (!this.config.enabled) {
      return {
        appendix: "",
        result: {
          documents: [],
          chunks: [],
          appendix: "",
          citations: [],
          latencyMs: 0,
          provider: this.provider.kind,
          fromCache: false,
        },
        hasUsefulExcerpts: false,
      };
    }

    const cacheKey = buildKnowledgeQueryCacheKey({
      organizationId: input.organizationId,
      botId: input.botId,
      provider: this.provider.kind,
      query: input.userMessage,
      maxChunks: this.config.maxChunks,
    });

    if (input.cacheEnabled !== false) {
      const cached = getCachedQuery(cacheKey);
      if (cached) {
        return {
          appendix: cached.appendix,
          result: cached,
          hasUsefulExcerpts: kbAppendixHasRetrievedExcerpts(cached.appendix),
        };
      }
    }

    const result = await this.provider.buildProactiveAppendix({
      ...input,
      config: this.config,
    });

    if (input.cacheEnabled !== false) {
      setCachedQuery(cacheKey, result);
    }

    return {
      appendix: result.appendix,
      result,
      hasUsefulExcerpts: kbAppendixHasRetrievedExcerpts(result.appendix),
    };
  }

  async searchForTool(input: {
    organizationId: string;
    botId: string;
    query: string;
    pinnedArticleIds?: string[];
  }): Promise<{ chunks: KnowledgeChunk[]; toolJson: string; result: KnowledgeQueryResult }> {
    const result = await this.provider.search(
      {
        organizationId: input.organizationId,
        botId: input.botId,
        query: input.query,
        pinnedArticleIds: input.pinnedArticleIds,
        limit: this.config.maxChunks,
      },
      this.config,
    );
    return {
      chunks: result.chunks,
      toolJson: this.provider.formatToolResult(result.chunks),
      result,
    };
  }

  buildObservabilityEvent(result: KnowledgeQueryResult, query: string, botId?: string) {
    return buildKnowledgeQueryEvent({
      provider: result.provider,
      query,
      documentCount: result.documents.length,
      chunkCount: result.chunks.length,
      latencyMs: result.latencyMs,
      topScore: result.chunks[0]?.score,
      fromCache: result.fromCache,
      botId,
    });
  }
}
