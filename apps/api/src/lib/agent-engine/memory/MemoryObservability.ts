import type { AutomationExecutionLogPort } from "../../automationExecutionLog.js";
import type { MemoryObservabilityEvent } from "./memoryEngineTypes.js";

export function logMemoryEvents(
  executionLog: AutomationExecutionLogPort | null | undefined,
  events: MemoryObservabilityEvent[],
): void {
  if (!executionLog || events.length === 0) return;
  for (const ev of events) {
    executionLog.info(
      { id: "memory_engine", name: "OpenNexo Memory Engine" },
      `Memória ${ev.action}${ev.category ? ` (${ev.category})` : ""}`,
      {
        output: {
          action: ev.action,
          scope: ev.scope,
          category: ev.category,
          origin: ev.origin,
          memoryId: ev.memoryId,
          count: ev.count,
          latencyMs: ev.latencyMs,
          tokensEstimate: ev.tokensEstimate,
        },
      },
    );
  }
}

export function buildLoadedEvent(input: {
  count: number;
  latencyMs: number;
  tokensEstimate: number;
}): MemoryObservabilityEvent {
  return {
    action: "loaded",
    scope: "contact",
    count: input.count,
    latencyMs: input.latencyMs,
    tokensEstimate: input.tokensEstimate,
  };
}

export function buildCreatedEvent(input: {
  scope: MemoryObservabilityEvent["scope"];
  category?: MemoryObservabilityEvent["category"];
  origin?: MemoryObservabilityEvent["origin"];
  memoryId?: string;
}): MemoryObservabilityEvent {
  return {
    action: "created",
    scope: input.scope,
    category: input.category,
    origin: input.origin,
    memoryId: input.memoryId,
    count: 1,
  };
}

export function buildUpdatedEvent(input: {
  scope: MemoryObservabilityEvent["scope"];
  memoryId: string;
  category?: MemoryObservabilityEvent["category"];
}): MemoryObservabilityEvent {
  return {
    action: "updated",
    scope: input.scope,
    memoryId: input.memoryId,
    category: input.category,
    count: 1,
  };
}
