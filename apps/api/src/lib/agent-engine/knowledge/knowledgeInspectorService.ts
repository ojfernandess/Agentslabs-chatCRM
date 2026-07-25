import type {
  KnowledgeEngineConfig,
  KnowledgeInspectorTrace,
  KnowledgeSearchMode,
} from "./knowledgeEngineTypes.js";
import { KnowledgeEngineService } from "./KnowledgeProvider.js";
import { buildKnowledgeQueryEvent } from "./KnowledgeObservability.js";
import { getCachedQuery, buildKnowledgeQueryCacheKey } from "./knowledgeCache.js";

export async function runKnowledgeInspector(input: {
  organizationId: string;
  botId?: string;
  query: string;
  config: KnowledgeEngineConfig;
  mode?: KnowledgeSearchMode;
  pinnedArticleIds?: string[];
  cacheEnabled?: boolean;
}): Promise<KnowledgeInspectorTrace> {
  const service = KnowledgeEngineService.fromConfig(input.config);
  const cacheKey = buildKnowledgeQueryCacheKey({
    organizationId: input.organizationId,
    botId: input.botId,
    provider: input.config.provider,
    query: input.query,
    maxChunks: input.config.maxChunks,
  });

  const cached = input.cacheEnabled !== false ? getCachedQuery(cacheKey) : null;
  const events = [];

  if (cached) {
    events.push(
      buildKnowledgeQueryEvent({
        provider: cached.provider,
        query: input.query,
        documentCount: cached.documents.length,
        chunkCount: cached.chunks.length,
        latencyMs: cached.latencyMs,
        topScore: cached.chunks[0]?.score,
        fromCache: true,
        botId: input.botId,
      }),
    );
    return {
      query: input.query,
      provider: input.config.provider,
      searchMode: input.mode ?? "semantic",
      documents: cached.documents,
      chunks: cached.chunks,
      rerankedChunks: cached.chunks,
      citations: cached.citations,
      appendix: cached.appendix,
      latencyMs: cached.latencyMs,
      fromCache: true,
      events,
    };
  }

  const started = Date.now();
  const result = await service.delegate.retrieve(
    {
      organizationId: input.organizationId,
      botId: input.botId,
      query: input.query,
      pinnedArticleIds: input.pinnedArticleIds,
      mode: input.mode ?? "semantic",
      maxDocuments: input.config.maxDocuments,
      maxChunks: input.config.maxChunks,
    },
    input.config,
  );

  events.push(
    buildKnowledgeQueryEvent({
      provider: result.provider,
      query: input.query,
      documentCount: result.documents.length,
      chunkCount: result.chunks.length,
      latencyMs: result.latencyMs,
      topScore: result.chunks[0]?.score,
      fromCache: false,
      botId: input.botId,
    }),
  );

  return {
    query: input.query,
    provider: input.config.provider,
    searchMode: input.mode ?? "semantic",
    documents: result.documents,
    chunks: result.chunks,
    rerankedChunks: input.config.reranking ? result.chunks : result.chunks,
    citations: result.citations,
    appendix: result.appendix,
    latencyMs: Date.now() - started,
    fromCache: false,
    events,
  };
}
