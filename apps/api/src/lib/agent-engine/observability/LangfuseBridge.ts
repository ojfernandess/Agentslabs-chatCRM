import { randomUUID } from "node:crypto";
import type { AgentExecutionTrace, AgentGraphEvent, AgentTraceNode } from "../types.js";

export type LangfuseConfig = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
};

/** Camadas do Runtime OpenNexo — spans Langfuse (Fase 5). */
export type RuntimeLayerId =
  | "intent"
  | "prompt_compiler"
  | "memory"
  | "scheduler"
  | "runtime"
  | "contract"
  | "supervisor"
  | "resilience"
  | "outbound"
  | "observability"
  | "architecture_governance";

const NODE_LAYER: Record<string, RuntimeLayerId> = {
  classify_intent: "intent",
  load_memory: "memory",
  schedule_tools: "scheduler",
  select_tool: "scheduler",
  execute_tool: "runtime",
  validate_result: "contract",
  supervisor: "supervisor",
  human_review: "supervisor",
  update_memory: "memory",
  respond: "outbound",
  kb_read_node: "runtime",
  merge_kb_results: "runtime",
};

const EVENT_LAYER: Partial<Record<string, RuntimeLayerId>> = {
  turn_context: "prompt_compiler",
  retry: "resilience",
  supervisor: "supervisor",
  hitl: "supervisor",
  memory: "memory",
  knowledge: "runtime",
  tool: "runtime",
  error: "observability",
  checkpoint: "observability",
  architecture_review: "architecture_governance",
  quality_gate: "architecture_governance",
  ci_gate: "architecture_governance",
};

export function resolveRuntimeLayer(nodeIdOrEventKind: string): RuntimeLayerId {
  return NODE_LAYER[nodeIdOrEventKind] ?? EVENT_LAYER[nodeIdOrEventKind] ?? "observability";
}

export function readLangfuseConfig(): LangfuseConfig | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const baseUrl = (
    process.env.LANGFUSE_BASE_URL ??
    process.env.LANGFUSE_HOST ??
    "https://cloud.langfuse.com"
  ).replace(/\/+$/, "");
  return { publicKey, secretKey, baseUrl };
}

export function isLangfuseConfigured(): boolean {
  return readLangfuseConfig() != null;
}

function authHeader(cfg: LangfuseConfig): string {
  const token = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  return `Basic ${token}`;
}

type IngestionEvent = {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
};

function layerSpan(
  traceId: string,
  layer: RuntimeLayerId,
  startedAt: string,
  endedAt: string | undefined,
  metadata: Record<string, unknown>,
): IngestionEvent {
  return {
    id: randomUUID(),
    type: "span-create",
    timestamp: startedAt,
    body: {
      traceId,
      id: `${traceId}:layer:${layer}`,
      name: `layer/${layer}`,
      startTime: startedAt,
      endTime: endedAt,
      metadata: { layer, ...metadata },
    },
  };
}

/** Agrega nós do grafo em spans de camada (1 span por layer com min/max tempo). */
export function buildLayerSpans(
  traceId: string,
  nodes: AgentTraceNode[],
  events: AgentGraphEvent[] = [],
  turn?: AgentExecutionTrace["turn"],
): IngestionEvent[] {
  const byLayer = new Map<
    RuntimeLayerId,
    { startedAt: string; endedAt?: string; nodeIds: string[]; details: string[] }
  >();

  for (const node of nodes) {
    const layer = resolveRuntimeLayer(String(node.id));
    const cur = byLayer.get(layer);
    if (!cur) {
      byLayer.set(layer, {
        startedAt: node.startedAt,
        endedAt: node.endedAt,
        nodeIds: [String(node.id)],
        details: node.detail ? [node.detail] : [],
      });
    } else {
      if (node.startedAt < cur.startedAt) cur.startedAt = node.startedAt;
      if (node.endedAt && (!cur.endedAt || node.endedAt > cur.endedAt)) cur.endedAt = node.endedAt;
      cur.nodeIds.push(String(node.id));
      if (node.detail) cur.details.push(node.detail);
    }
  }

  for (const ev of events) {
    const layer = resolveRuntimeLayer(ev.kind);
    if (!byLayer.has(layer) && (ev.kind === "turn_context" || ev.kind === "retry")) {
      byLayer.set(layer, {
        startedAt: ev.at,
        endedAt: ev.at,
        nodeIds: [ev.kind],
        details: ev.detail ? [ev.detail] : [],
      });
    }
  }

  const spans: IngestionEvent[] = [];
  for (const [layer, agg] of byLayer) {
    spans.push(
      layerSpan(traceId, layer, agg.startedAt, agg.endedAt, {
        nodeIds: agg.nodeIds,
        detailPreview: agg.details.slice(0, 3).join(" · ").slice(0, 400),
        ...(layer === "prompt_compiler" || layer === "contract"
          ? {
              contractValid: turn?.contractValid,
              pendingTools: turn?.pendingToolNames,
              intent: turn?.intentKind,
              promptHash: turn?.promptHash,
            }
          : {}),
      }),
    );
  }
  return spans;
}

export type ArchitectureGovernanceTraceInput = {
  traceId: string;
  gateResults: Array<{ id: string; passed: boolean; message?: string }>;
  architectureScore?: number;
  adrId?: string;
  modifiedFiles?: string[];
};

/** Span Langfuse para decisões AGS / CI gates (Fase 8). */
export function buildArchitectureGovernanceSpan(input: ArchitectureGovernanceTraceInput): IngestionEvent {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: "span-create",
    timestamp: now,
    body: {
      traceId: input.traceId,
      id: `${input.traceId}:architecture_governance`,
      name: "architecture_governance",
      startTime: now,
      metadata: {
        layer: "architecture_governance",
        gates: input.gateResults,
        architectureScore: input.architectureScore,
        adrId: input.adrId,
        modifiedFiles: input.modifiedFiles?.slice(0, 20),
        passed: input.gateResults.every((g) => g.passed),
      },
    },
  };
}

function buildLangfuseBatch(input: {
  traceId: string;
  trace: AgentExecutionTrace;
  organizationId: string;
  conversationId: string;
  botId: string;
  messageId?: string;
}): IngestionEvent[] {
  const now = new Date().toISOString();
  const batch: IngestionEvent[] = [
    {
      id: randomUUID(),
      type: "trace-create",
      timestamp: now,
      body: {
        id: input.traceId,
        name: `openconduit/${input.trace.runtime}`,
        userId: input.conversationId,
        metadata: {
          organizationId: input.organizationId,
          botId: input.botId,
          messageId: input.messageId,
          strictMode: input.trace.strictMode,
          memory: input.trace.memory,
          turn: input.trace.turn
            ? {
                intent: input.trace.turn.intentKind,
                contractValid: input.trace.turn.contractValid,
                pending: input.trace.turn.pendingToolNames,
              }
            : undefined,
        },
      },
    },
  ];

  // Spans por camada (Fase 5)
  batch.push(
    ...buildLayerSpans(
      input.traceId,
      input.trace.nodes,
      input.trace.events ?? [],
      input.trace.turn,
    ),
  );

  for (const node of input.trace.nodes) {
    const layer = resolveRuntimeLayer(String(node.id));
    batch.push({
      id: randomUUID(),
      type: "span-create",
      timestamp: node.startedAt,
      body: {
        traceId: input.traceId,
        id: `${input.traceId}:node:${node.id}`,
        name: node.name,
        startTime: node.startedAt,
        endTime: node.endedAt,
        metadata: { status: node.status, detail: node.detail, layer },
      },
    });
  }

  for (const ev of input.trace.events ?? []) {
    batch.push(spanFromGraphEvent(input.traceId, ev));
  }

  if (input.trace.supervisor) {
    batch.push({
      id: randomUUID(),
      type: "span-create",
      timestamp: now,
      body: {
        traceId: input.traceId,
        id: `${input.traceId}:supervisor`,
        name: "supervisor",
        metadata: {
          layer: "supervisor",
          approved: input.trace.supervisor.approved,
          summary: input.trace.supervisor.summary,
          checks: input.trace.supervisor.checks,
        },
      },
    });
  }

  if (input.trace.turn) {
    batch.push({
      id: randomUUID(),
      type: "span-create",
      timestamp: now,
      body: {
        traceId: input.traceId,
        id: `${input.traceId}:contract`,
        name: "execution_contract",
        metadata: {
          layer: "contract",
          ...input.trace.turn,
        },
      },
    });
  }

  return batch;
}

function spanFromGraphEvent(traceId: string, ev: AgentGraphEvent): IngestionEvent {
  const layer = resolveRuntimeLayer(ev.kind);
  return {
    id: randomUUID(),
    type: "span-create",
    timestamp: ev.at,
    body: {
      traceId,
      id: `${traceId}:event:${ev.kind}:${ev.at}`,
      name: ev.kind,
      metadata: { layer, nodeId: ev.nodeId, detail: ev.detail, ...ev.metadata },
    },
  };
}

/** Envia trace do Agent Engine para Langfuse (fire-and-forget; falhas silenciosas). */
export async function ingestAgentTraceToLangfuse(input: {
  trace: AgentExecutionTrace;
  organizationId: string;
  conversationId: string;
  botId: string;
  messageId?: string;
  traceId?: string;
}): Promise<{ ok: boolean; traceId?: string; error?: string }> {
  const cfg = readLangfuseConfig();
  if (!cfg) return { ok: false, error: "langfuse_not_configured" };

  const traceId = input.traceId ?? randomUUID();
  const batch = buildLangfuseBatch({ ...input, traceId });

  try {
    const res = await fetch(`${cfg.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        Authorization: authHeader(cfg),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch }),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, traceId, error: `langfuse_http_${res.status}:${text.slice(0, 200)}` };
    }

    try {
      const body = text ? (JSON.parse(text) as { errors?: unknown[] }) : null;
      if (body?.errors && Array.isArray(body.errors) && body.errors.length > 0) {
        return {
          ok: false,
          traceId,
          error: `langfuse_batch_errors:${JSON.stringify(body.errors).slice(0, 300)}`,
        };
      }
    } catch {
      // Resposta não-JSON (ex.: proxy) — HTTP 2xx tratamos como sucesso.
    }

    return { ok: true, traceId };
  } catch (err) {
    return {
      ok: false,
      traceId,
      error: err instanceof Error ? err.message : "langfuse_fetch_failed",
    };
  }
}
