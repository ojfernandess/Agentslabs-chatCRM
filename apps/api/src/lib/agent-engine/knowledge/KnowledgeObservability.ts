import type { KnowledgeObservabilityEvent } from "./knowledgeEngineTypes.js";
import type { AutomationExecutionLogPort } from "../../automationExecutionLog.js";

export function buildKnowledgeQueryEvent(input: {
  provider: KnowledgeObservabilityEvent["provider"];
  query: string;
  documentCount: number;
  chunkCount: number;
  latencyMs: number;
  topScore?: number;
  fromCache?: boolean;
  botId?: string;
}): KnowledgeObservabilityEvent {
  return {
    action: input.fromCache ? "cache_hit" : "query",
    provider: input.provider,
    query: input.query.slice(0, 500),
    documentCount: input.documentCount,
    chunkCount: input.chunkCount,
    latencyMs: input.latencyMs,
    topScore: input.topScore,
    fromCache: input.fromCache,
    botId: input.botId,
  };
}

export function logKnowledgeEvents(
  ex: AutomationExecutionLogPort | null | undefined,
  events: KnowledgeObservabilityEvent[],
): void {
  if (!ex || events.length === 0) return;
  for (const event of events) {
    ex.info(
      { id: "knowledge_engine", name: "OpenNexo Knowledge Engine" },
      `KB ${event.action}`,
      {
        output: {
          provider: event.provider,
          documentCount: event.documentCount,
          chunkCount: event.chunkCount,
          latencyMs: event.latencyMs,
          topScore: event.topScore,
          fromCache: event.fromCache,
        },
      },
    );
  }
}
