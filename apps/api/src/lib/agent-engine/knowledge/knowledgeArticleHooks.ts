import { clearKnowledgeCache } from "./knowledgeCache.js";

/** Invalida cache do Knowledge Engine após alterações na KB (não afecta pipeline RAG legado). */
export function invalidateKnowledgeEngineCache(organizationId: string): void {
  if (!organizationId) return;
  clearKnowledgeCache({ organizationId });
}
