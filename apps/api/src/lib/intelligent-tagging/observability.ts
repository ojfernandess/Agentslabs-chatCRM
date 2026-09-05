import { randomUUID } from "node:crypto";
import { isLangfuseConfigured, readLangfuseConfig } from "../agent-engine/observability/LangfuseBridge.js";
import {
  getRecentOtelSpans,
  ingestOtelSpans,
  isOtelExportConfigured,
  type OtelSpan,
} from "../agent-engine/observability/OtelBridge.js";
import type { IntelligentTaggingGraphState } from "./types.js";

export type TaggingTracePayload = {
  traceId: string;
  organizationId: string;
  conversationId: string;
  trigger: string;
  latencyMs: number;
  autoAppliedCount: number;
  pendingReviewCount: number;
  error?: string;
  modelUsed?: string;
};

function buildTaggingOtelSpans(payload: TaggingTracePayload): OtelSpan[] {
  const traceId = payload.traceId.replace(/-/g, "").slice(0, 32);
  const spanId = randomUUID().replace(/-/g, "").slice(0, 16);
  const started = Date.now() - payload.latencyMs;
  const ended = Date.now();

  return [
    {
      traceId,
      spanId,
      name: "intelligent_tagging.run",
      startTimeUnixNano: String(BigInt(started) * 1_000_000n),
      endTimeUnixNano: String(BigInt(ended) * 1_000_000n),
      attributes: {
        "service.name": process.env.OTEL_SERVICE_NAME?.trim() || "openconduit-intelligent-tagging",
        organization_id: payload.organizationId,
        conversation_id: payload.conversationId,
        trigger: payload.trigger,
        auto_applied_count: payload.autoAppliedCount,
        pending_review_count: payload.pendingReviewCount,
        model: payload.modelUsed ?? "",
        error: payload.error ?? "",
      },
      status: payload.error ? "error" : "ok",
      layer: "observability",
    },
  ];
}

export async function emitTaggingObservability(
  state: IntelligentTaggingGraphState,
  runMeta: { runId: string; latencyMs: number },
): Promise<string> {
  const traceId = randomUUID();
  const payload: TaggingTracePayload = {
    traceId,
    organizationId: state.organizationId,
    conversationId: state.conversationId,
    trigger: state.trigger,
    latencyMs: runMeta.latencyMs,
    autoAppliedCount: state.autoApply.length,
    pendingReviewCount: state.pendingReview.length,
    error: state.error,
    modelUsed: state.modelUsed,
  };

  const spans = buildTaggingOtelSpans(payload);
  void ingestOtelSpans(spans, { serviceName: "openconduit-intelligent-tagging" });

  if (isLangfuseConfigured()) {
    const cfg = readLangfuseConfig()!;
    const body = {
      batch: [
        {
          id: randomUUID(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: traceId,
            name: "intelligent_tagging",
            userId: state.organizationId,
            sessionId: state.conversationId,
            metadata: {
              trigger: state.trigger,
              autoAppliedCount: payload.autoAppliedCount,
              pendingReviewCount: payload.pendingReviewCount,
              model: state.modelUsed,
              error: state.error,
            },
          },
        },
      ],
    };
    void fetch(`${cfg.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  return traceId;
}

export { getRecentOtelSpans, isOtelExportConfigured };
