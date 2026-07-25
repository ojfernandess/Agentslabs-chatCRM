import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseKnowledgeEngineConfig,
  mergeKnowledgeEngineIntoBehavior,
  shouldUseKnowledgeEngineRuntime,
  parseKnowledgeEngineUseRecommendedSettings,
} from "./parseKnowledgeEngineConfig.js";
import { DEFAULT_KNOWLEDGE_ENGINE_CONFIG } from "./knowledgeEngineTypes.js";
import { applyKnowledgeEngineRecommendations } from "./knowledgeEngineRecommendations.js";
import {
  buildKnowledgeQueryCacheKey,
  clearKnowledgeCache,
  getCachedQuery,
  setCachedQuery,
} from "./knowledgeCache.js";
import { invalidateKnowledgeEngineCache } from "./knowledgeArticleHooks.js";

test("parseKnowledgeEngineConfig defaults for legacy agents", () => {
  const cfg = parseKnowledgeEngineConfig({ nativeTools: { knowledge_search: true } });
  assert.equal(cfg.provider, "openconduit");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.maxDocuments, 10);
});

test("shouldUseKnowledgeEngineRuntime only for llamaindex", () => {
  assert.equal(shouldUseKnowledgeEngineRuntime({}), false);
  assert.equal(shouldUseKnowledgeEngineRuntime({ knowledgeEngine: { provider: "openconduit" } }), false);
  assert.equal(shouldUseKnowledgeEngineRuntime({ knowledgeEngine: { provider: "llamaindex" } }), true);
});

test("mergeKnowledgeEngineIntoBehavior syncs nativeTools", () => {
  const merged = mergeKnowledgeEngineIntoBehavior(
    { nativeTools: { knowledge_search: false } },
    { ...DEFAULT_KNOWLEDGE_ENGINE_CONFIG, enabled: false },
  );
  assert.equal((merged.nativeTools as Record<string, unknown>).knowledge_search, false);
});

test("parseKnowledgeEngineUseRecommendedSettings reads flag", () => {
  assert.equal(parseKnowledgeEngineUseRecommendedSettings({}), false);
  assert.equal(
    parseKnowledgeEngineUseRecommendedSettings({
      knowledgeEngine: { provider: "llamaindex", useRecommendedSettings: true },
    }),
    true,
  );
});

test("applyKnowledgeEngineRecommendations overrides limits and chunking", () => {
  const base = { ...DEFAULT_KNOWLEDGE_ENGINE_CONFIG, provider: "llamaindex" as const };
  const applied = applyKnowledgeEngineRecommendations(base, {
    maxDocuments: 7,
    maxChunks: 42,
    searchTemperature: 0,
    chunkSize: 1200,
    chunkOverlap: 156,
    stats: {
      documentCount: 7,
      totalChars: 50000,
      avgDocChars: 7142,
      indexedChunkCount: 40,
      estimatedChunkCount: 42,
      scopedToBot: false,
    },
  });
  assert.equal(applied.maxDocuments, 7);
  assert.equal(applied.maxChunks, 42);
  assert.equal(applied.chunking.chunkSize, 1200);
  assert.equal(applied.chunking.chunkOverlap, 156);
});

test("knowledge query cache round-trip", () => {
  clearKnowledgeCache();
  const key = buildKnowledgeQueryCacheKey({
    organizationId: "org-1",
    botId: "bot-1",
    provider: "llamaindex",
    query: "horário check-in",
    maxChunks: 20,
  });
  assert.equal(getCachedQuery(key), null);
  setCachedQuery(key, {
    documents: [],
    chunks: [],
    appendix: "test",
    citations: [],
    latencyMs: 1,
    provider: "llamaindex",
    fromCache: false,
  });
  const hit = getCachedQuery(key);
  assert.ok(hit);
  assert.equal(hit.appendix, "test");
  assert.equal(hit.fromCache, true);
});

test("invalidateKnowledgeEngineCache scopes by organization", () => {
  clearKnowledgeCache();
  const key = buildKnowledgeQueryCacheKey({
    organizationId: "org-a",
    provider: "llamaindex",
    query: "q",
    maxChunks: 10,
  });
  setCachedQuery(key, {
    documents: [],
    chunks: [],
    appendix: "",
    citations: [],
    latencyMs: 0,
    provider: "llamaindex",
    fromCache: false,
  });
  invalidateKnowledgeEngineCache("org-a");
  assert.equal(getCachedQuery(key), null);
});
