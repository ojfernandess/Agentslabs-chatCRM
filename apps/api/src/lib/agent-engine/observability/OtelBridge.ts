/**
 * OpenTelemetry-compatible bridge sem dependência npm obrigatória.
 * - Sempre grava spans in-memory (inspector / testes).
 * - Se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver definido, exporta OTLP/HTTP JSON.
 */

import { randomBytes } from "node:crypto";
import type { AgentExecutionTrace } from "../types.js";
import { resolveRuntimeLayer, type RuntimeLayerId } from "./LangfuseBridge.js";

export type OtelSpanStatus = "ok" | "error" | "unset";

export type OtelSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  status: OtelSpanStatus;
  layer?: RuntimeLayerId;
};

export type OtelExportResult = {
  exported: boolean;
  spanCount: number;
  endpoint?: string;
  error?: string;
};

const recentSpans: OtelSpan[] = [];
const MAX_RECENT = 500;

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function toUnixNano(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  const safe = Number.isFinite(ms) ? ms : Date.now();
  return String(BigInt(Math.floor(safe)) * 1_000_000n);
}

export function isOtelExportConfigured(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

export function readOtelEndpoint(): string | null {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function clearOtelSpansForTests(): void {
  recentSpans.length = 0;
}

export function getRecentOtelSpans(): OtelSpan[] {
  return [...recentSpans];
}

function pushSpan(span: OtelSpan): void {
  recentSpans.push(span);
  if (recentSpans.length > MAX_RECENT) {
    recentSpans.splice(0, recentSpans.length - MAX_RECENT);
  }
}

/** Constrói spans OTEL a partir do AgentExecutionTrace (mesmas camadas do Langfuse). */
export function buildOtelSpansFromTrace(
  trace: AgentExecutionTrace,
  opts?: { serviceName?: string; turnId?: string },
): OtelSpan[] {
  const traceId = randomHex(16);
  const rootId = randomHex(8);
  const serviceName = opts?.serviceName ?? "opennexo-agent-engine";
  const started =
    trace.nodes[0]?.startedAt ?? new Date(Date.now() - (trace.latencyMs ?? 0)).toISOString();
  const ended =
    trace.nodes[trace.nodes.length - 1]?.endedAt ?? new Date().toISOString();

  const spans: OtelSpan[] = [
    {
      traceId,
      spanId: rootId,
      name: `agent.${trace.runtime}.turn`,
      startTimeUnixNano: toUnixNano(started),
      endTimeUnixNano: toUnixNano(ended),
      attributes: {
        "service.name": serviceName,
        "openconduit.runtime": trace.runtime,
        "openconduit.memory": trace.memory,
        "openconduit.strict_mode": trace.strictMode,
        ...(opts?.turnId ? { "openconduit.turn_id": opts.turnId } : {}),
        ...(trace.latencyMs != null ? { "openconduit.latency_ms": trace.latencyMs } : {}),
      },
      status: trace.errors.length > 0 ? "error" : "ok",
      layer: "runtime",
    },
  ];

  for (const node of trace.nodes) {
    const layer = resolveRuntimeLayer(node.id);
    const spanId = randomHex(8);
    const nStart = node.startedAt ?? started;
    const nEnd = node.endedAt ?? nStart;
    spans.push({
      traceId,
      spanId,
      parentSpanId: rootId,
      name: `agent.node.${node.id}`,
      startTimeUnixNano: toUnixNano(nStart),
      endTimeUnixNano: toUnixNano(nEnd),
      attributes: {
        "service.name": serviceName,
        "openconduit.node_id": node.id,
        "openconduit.node_name": node.name,
        "openconduit.layer": layer,
        ...(node.status ? { "openconduit.node_status": node.status } : {}),
      },
      status: node.status === "error" ? "error" : "ok",
      layer,
    });
  }

  return spans;
}

function spansToOtlpJson(spans: OtelSpan[], serviceName: string): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "opennexo.agent-engine", version: "1" },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: 1,
              startTimeUnixNano: s.startTimeUnixNano,
              endTimeUnixNano: s.endTimeUnixNano,
              attributes: Object.entries(s.attributes).map(([key, value]) => {
                if (typeof value === "number") {
                  return { key, value: { doubleValue: value } };
                }
                if (typeof value === "boolean") {
                  return { key, value: { boolValue: value } };
                }
                return { key, value: { stringValue: String(value) } };
              }),
              status: {
                code: s.status === "error" ? 2 : s.status === "ok" ? 1 : 0,
              },
            })),
          },
        ],
      },
    ],
  };
}

/**
 * Regista spans localmente e tenta export OTLP/HTTP se endpoint configurado.
 */
async function exportOtelSpansToEndpoint(
  spans: OtelSpan[],
  serviceName: string,
): Promise<OtelExportResult> {
  const endpoint = readOtelEndpoint();
  if (!endpoint) {
    return { exported: false, spanCount: spans.length };
  }

  const url = endpoint.includes("/v1/traces") ? endpoint : `${endpoint}/v1/traces`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.OTEL_EXPORTER_OTLP_HEADERS
          ? Object.fromEntries(
              process.env.OTEL_EXPORTER_OTLP_HEADERS.split(",")
                .map((p) => p.split("=").map((x) => x.trim()))
                .filter((kv): kv is [string, string] => kv.length === 2 && Boolean(kv[0])),
            )
          : {}),
      },
      body: JSON.stringify(spansToOtlpJson(spans, serviceName)),
    });
    if (!res.ok) {
      return {
        exported: false,
        spanCount: spans.length,
        endpoint: url,
        error: `http_${res.status}`,
      };
    }
    return { exported: true, spanCount: spans.length, endpoint: url };
  } catch (err) {
    return {
      exported: false,
      spanCount: spans.length,
      endpoint: url,
      error: err instanceof Error ? err.message : "export_failed",
    };
  }
}

/** Grava spans in-memory e exporta OTLP quando configurado. */
export async function ingestOtelSpans(
  spans: OtelSpan[],
  opts?: { serviceName?: string },
): Promise<OtelExportResult> {
  for (const s of spans) pushSpan(s);
  const serviceName =
    opts?.serviceName ?? process.env.OTEL_SERVICE_NAME?.trim() ?? "opennexo-agent-engine";
  return exportOtelSpansToEndpoint(spans, serviceName);
}

export async function ingestAgentTraceToOtel(
  trace: AgentExecutionTrace,
  opts?: { serviceName?: string; turnId?: string; enabled?: boolean },
): Promise<OtelExportResult> {
  if (opts?.enabled === false) {
    return { exported: false, spanCount: 0 };
  }
  const serviceName = opts?.serviceName ?? process.env.OTEL_SERVICE_NAME?.trim() ?? "opennexo-agent-engine";
  const spans = buildOtelSpansFromTrace(trace, { serviceName, turnId: opts?.turnId });
  for (const s of spans) pushSpan(s);
  return exportOtelSpansToEndpoint(spans, serviceName);
}
