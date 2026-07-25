/** Provider de RAG suportados pelo OpenNexo Knowledge Engine. */
export type KnowledgeProviderKind = "openconduit" | "llamaindex";

export type KnowledgeDocumentStatus = "active" | "archived" | "indexing" | "error";

export type KnowledgeChunkMetadata = {
  chunkIndex: number;
  page?: number;
  section?: string;
  hierarchy?: string[];
  separator?: string;
  tokenEstimate?: number;
};

/** Documento normalizado (mapeia `AutomationKnowledgeArticle` + metadados). */
export type KnowledgeDocument = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  origin: string | null;
  author: string | null;
  organizationId: string;
  tags: string[];
  language: string | null;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
  tokenEstimate: number;
  version: number;
  status: KnowledgeDocumentStatus;
  sourceUrl?: string | null;
  botIds?: string[];
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  documentName: string;
  text: string;
  score: number;
  similarity?: number;
  metadata: KnowledgeChunkMetadata;
  excerpt: string;
};

export type KnowledgeSearchMode =
  | "semantic"
  | "similarity"
  | "hybrid"
  | "tags"
  | "category"
  | "metadata";

export type KnowledgeSearchFilters = {
  tags?: string[];
  category?: string;
  botId?: string;
  company?: string;
  agentId?: string;
  metadata?: Record<string, string>;
};

export type KnowledgeIndexInput = {
  organizationId: string;
  documentId?: string;
  botId?: string;
  force?: boolean;
};

export type KnowledgeIndexResult = {
  indexed: number;
  skipped: number;
  chunks: number;
  errors: string[];
};

export type KnowledgeQueryInput = {
  organizationId: string;
  botId?: string;
  query: string;
  limit?: number;
  filters?: KnowledgeSearchFilters;
  pinnedArticleIds?: string[];
  mode?: KnowledgeSearchMode;
};

export type KnowledgeSearchInput = KnowledgeQueryInput;

export type KnowledgeRetrieveInput = KnowledgeQueryInput & {
  maxDocuments?: number;
  maxChunks?: number;
};

export type KnowledgeRerankInput = {
  query: string;
  chunks: KnowledgeChunk[];
  topK?: number;
};

export type KnowledgeQueryResult = {
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
  appendix: string;
  citations: KnowledgeCitation[];
  latencyMs: number;
  provider: KnowledgeProviderKind;
  fromCache: boolean;
};

export type KnowledgeSearchResult = KnowledgeQueryResult;

export type KnowledgeRetrieveResult = KnowledgeQueryResult;

export type KnowledgeRerankResult = {
  chunks: KnowledgeChunk[];
};

export type KnowledgeCitation = {
  documentId: string;
  documentName: string;
  excerpt: string;
  page?: number;
  origin?: string | null;
  link?: string | null;
  score: number;
};

export type KnowledgeDocumentInput = {
  organizationId: string;
  name: string;
  content: string;
  category?: string | null;
  tags?: string[];
  botIds?: string[];
  origin?: string | null;
};

export type KnowledgeDocumentUpdateInput = {
  organizationId: string;
  documentId: string;
  patch: Partial<Pick<KnowledgeDocumentInput, "name" | "content" | "category" | "tags">>;
};

export type KnowledgeDocumentRemoveInput = {
  organizationId: string;
  documentId: string;
};

export type KnowledgeListInput = {
  organizationId: string;
  botId?: string;
  category?: string;
  limit?: number;
};

export type KnowledgeClearInput = {
  organizationId: string;
  documentId?: string;
};

export type KnowledgeChunkingConfig = {
  chunkSize: number;
  chunkOverlap: number;
  separator: string;
  autoChunk: boolean;
  preserveHierarchy: boolean;
};

/** Configuração por agente (`behaviorConfig.knowledgeEngine`). */
export type KnowledgeEngineConfig = {
  provider: KnowledgeProviderKind;
  enabled: boolean;
  semanticSearch: boolean;
  reranking: boolean;
  citations: boolean;
  maxDocuments: number;
  maxChunks: number;
  /** Temperatura / fuzziness da busca (0 = determinístico). */
  searchTemperature: number;
  minScore: number;
  minSimilarity: number;
  chunking: KnowledgeChunkingConfig;
};

export const DEFAULT_KNOWLEDGE_CHUNKING: KnowledgeChunkingConfig = {
  chunkSize: 900,
  chunkOverlap: 120,
  separator: "\n\n",
  autoChunk: true,
  preserveHierarchy: true,
};

export const DEFAULT_KNOWLEDGE_ENGINE_CONFIG: KnowledgeEngineConfig = {
  provider: "openconduit",
  enabled: true,
  semanticSearch: true,
  reranking: true,
  citations: true,
  maxDocuments: 10,
  maxChunks: 20,
  searchTemperature: 0,
  minScore: 0.25,
  minSimilarity: 0.2,
  chunking: DEFAULT_KNOWLEDGE_CHUNKING,
};

/** Configuração administrativa da organização. */
export type KnowledgeEngineOrgConfig = {
  provider: KnowledgeProviderKind;
  maxDocuments: number;
  maxChunks: number;
  minScore: number;
  minSimilarity: number;
  autoIndex: boolean;
  cacheEnabled: boolean;
  reranking: boolean;
  citations: boolean;
};

export const DEFAULT_KNOWLEDGE_ENGINE_ORG_CONFIG: KnowledgeEngineOrgConfig = {
  provider: "openconduit",
  maxDocuments: 10,
  maxChunks: 20,
  minScore: 0.25,
  minSimilarity: 0.2,
  autoIndex: true,
  cacheEnabled: true,
  reranking: true,
  citations: true,
};

export type KnowledgeObservabilityEvent = {
  action: "query" | "search" | "retrieve" | "index" | "rerank" | "cache_hit" | "cache_miss";
  provider: KnowledgeProviderKind;
  query: string;
  documentCount: number;
  chunkCount: number;
  latencyMs: number;
  tokensEstimate?: number;
  topScore?: number;
  fromCache?: boolean;
  botId?: string;
};

export type KnowledgeInspectorTrace = {
  query: string;
  provider: KnowledgeProviderKind;
  searchMode: KnowledgeSearchMode;
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
  rerankedChunks: KnowledgeChunk[];
  citations: KnowledgeCitation[];
  appendix: string;
  latencyMs: number;
  fromCache: boolean;
  events: KnowledgeObservabilityEvent[];
};
