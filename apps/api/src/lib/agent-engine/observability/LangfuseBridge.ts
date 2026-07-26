import { randomUUID } from "node:crypto";
import type { AgentExecutionTrace, AgentGraphEvent } from "../types.js";

export type LangfuseConfig = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
};

export function readLangfuseConfig(): LangfuseConfig | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const baseUrl = (process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com").replace(/\/+$/, "");
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
        },
      },
    },
  ];

  for (const node of input.trace.nodes) {
    batch.push({
      id: randomUUID(),
      type: "span-create",
      timestamp: node.startedAt,
      body: {
        traceId: input.traceId,
        id: `${input.traceId}:${node.id}`,
        name: node.name,
        startTime: node.startedAt,
        endTime: node.endedAt,
        metadata: { status: node.status, detail: node.detail },
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
          approved: input.trace.supervisor.approved,
          summary: input.trace.supervisor.summary,
          checks: input.trace.supervisor.checks,
        },
      },
    });
  }

  return batch;
}

function spanFromGraphEvent(traceId: string, ev: AgentGraphEvent): IngestionEvent {
  return {
    id: randomUUID(),
    type: "span-create",
    timestamp: ev.at,
    body: {
      traceId,
      id: `${traceId}:event:${ev.kind}:${ev.at}`,
      name: ev.kind,
      metadata: { nodeId: ev.nodeId, detail: ev.detail, ...ev.metadata },
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
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, traceId, error: `langfuse_http_${res.status}:${text.slice(0, 200)}` };
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
