import type {
  AgentExecutionTrace,
  AgentGraphNodeId,
  AgentRuntimeKind,
  AgentMemoryKind,
  AgentObservabilityLevel,
  AgentTraceNode,
} from "../types.js";

export class ExecutionTraceBuilder {
  private readonly trace: AgentExecutionTrace;
  private readonly nodeStarts = new Map<string, number>();

  constructor(input: {
    runtime: AgentRuntimeKind;
    memory: AgentMemoryKind;
    strictMode: boolean;
    observability: AgentObservabilityLevel;
  }) {
    this.trace = {
      runtime: input.runtime,
      memory: input.memory,
      strictMode: input.strictMode,
      observability: input.observability,
      nodes: [],
      errors: [],
    };
  }

  startNode(id: AgentGraphNodeId | string, name: string, detail?: string): void {
    this.trace.currentNode = id as AgentGraphNodeId;
    this.nodeStarts.set(id, Date.now());
    this.trace.nodes.push({
      id,
      name,
      status: "ok",
      startedAt: new Date().toISOString(),
      detail,
    });
  }

  endNode(id: AgentGraphNodeId | string, status: AgentTraceNode["status"] = "ok", detail?: string): void {
    const node = [...this.trace.nodes].reverse().find((n) => n.id === id && !n.endedAt);
    if (node) {
      node.status = status;
      node.endedAt = new Date().toISOString();
      if (detail) node.detail = detail;
    }
    const started = this.nodeStarts.get(id);
    if (started) {
      this.trace.latencyMs = (this.trace.latencyMs ?? 0) + (Date.now() - started);
    }
  }

  setNextNode(id: AgentGraphNodeId): void {
    this.trace.nextNode = id;
  }

  addError(message: string): void {
    this.trace.errors.push(message);
  }

  setMemorySnapshot(snapshot: Record<string, unknown>): void {
    if (this.trace.observability === "full") {
      this.trace.memorySnapshot = snapshot;
    }
  }

  setTokens(tokens: { prompt?: number; completion?: number; total?: number }): void {
    this.trace.tokens = tokens;
  }

  build(): AgentExecutionTrace {
    return { ...this.trace, nodes: [...this.trace.nodes] };
  }
}
