import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { MessageProcessingTrace, TraceQueryStat } from "./types.js";
import { captureResourceSnapshot } from "./systemMetrics.js";

export type ActiveTraceHandle = {
  trace: MessageProcessingTrace;
  stageStartedAt: number;
  stageCpuStart: number;
  finish: (status: "completed" | "error", errorMessage?: string) => MessageProcessingTrace;
  stage: (stage: string, label: string, meta?: Record<string, string | number | boolean | null>) => void;
  recordQuery: (model: string, action: string, durationMs: number) => void;
  increment: (key: string, by?: number) => void;
  recordEvent: (name: string) => void;
  addAnomaly: (
    code: string,
    severity: "info" | "warning" | "critical",
    message: string,
    meta?: Record<string, string | number | boolean | null>,
  ) => void;
  recordRealtimeEmit: (recipientCount: number, payloadBytes: number) => void;
  setMetaSend: (patch: Partial<MessageProcessingTrace["meta"]>) => void;
  setBot: (patch: Partial<MessageProcessingTrace["bot"]>) => void;
  setIds: (patch: { conversationId?: string; messageId?: string }) => void;
};

const als = new AsyncLocalStorage<ActiveTraceHandle>();

export function generateTraceId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `MSG-${y}${m}${d}-${h}${min}-${suffix}`;
}

function updatePeakSnapshot(trace: MessageProcessingTrace): void {
  const snap = captureResourceSnapshot();
  const peak = trace.snapshots.peak;
  if (snap.processCpuPercent > peak.processCpuPercent) {
    Object.assign(peak, snap);
  }
  if (snap.eventLoopLagMs > peak.eventLoopLagMs) {
    peak.eventLoopLagMs = snap.eventLoopLagMs;
  }
}

function finalizeQuerySummary(trace: MessageProcessingTrace): void {
  const total = trace.queries.length;
  const totalDurationMs = trace.queries.reduce((s, q) => s + q.durationMs, 0);
  const slowestMs = trace.queries.reduce((m, q) => Math.max(m, q.durationMs), 0);
  const patterns = new Map<string, number>();
  for (const q of trace.queries) {
    const key = `${q.model}.${q.action}`;
    patterns.set(key, (patterns.get(key) ?? 0) + 1);
  }
  const repeatedPatterns = [...patterns.entries()]
    .filter(([, count]) => count >= 3)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  trace.querySummary = { total, totalDurationMs, slowestMs, repeatedPatterns };
}

function buildHandle(trace: MessageProcessingTrace, onFinish: (t: MessageProcessingTrace) => void): ActiveTraceHandle {
  let stageStartedAt = performance.now();
  let stageCpuStart = captureResourceSnapshot().processCpuPercent;

  const finishStage = (stage: string, label: string, meta?: Record<string, string | number | boolean | null>) => {
    const endedAt = new Date();
    const durationMs = Math.round(performance.now() - stageStartedAt);
    const cpuEnd = captureResourceSnapshot().processCpuPercent;
    trace.spans.push({
      stage,
      label,
      startedAt: new Date(endedAt.getTime() - durationMs).toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs,
      cpuDeltaPercent: Math.max(0, cpuEnd - stageCpuStart),
      meta,
    });
    updatePeakSnapshot(trace);
    stageStartedAt = performance.now();
    stageCpuStart = captureResourceSnapshot().processCpuPercent;
  };

  return {
    trace,
    stageStartedAt,
    stageCpuStart,
    stage(stage, label, meta) {
      finishStage(stage, label, meta);
    },
    recordQuery(model, action, durationMs) {
      trace.queries.push({ model, action, durationMs, at: new Date().toISOString() });
      updatePeakSnapshot(trace);
    },
    increment(key, by = 1) {
      trace.counters[key] = (trace.counters[key] ?? 0) + by;
    },
    recordEvent(name) {
      const existing = trace.events.find((e) => e.name === name);
      const at = new Date().toISOString();
      if (existing) {
        existing.count += 1;
        existing.lastAt = at;
      } else {
        trace.events.push({ name, count: 1, firstAt: at, lastAt: at });
      }
      trace.counters[`event:${name}`] = (trace.counters[`event:${name}`] ?? 0) + 1;
    },
    addAnomaly(code, severity, message, meta) {
      trace.anomalies.push({ code, severity, message, at: new Date().toISOString(), meta });
    },
    recordRealtimeEmit(recipientCount, payloadBytes) {
      trace.realtime.emits += 1;
      trace.realtime.recipients += recipientCount;
      trace.realtime.payloadBytes += payloadBytes;
      const at = new Date().toISOString();
      const existing = trace.events.find((e) => e.name === "websocket.emit");
      if (existing) {
        existing.count += 1;
        existing.lastAt = at;
      } else {
        trace.events.push({ name: "websocket.emit", count: 1, firstAt: at, lastAt: at });
      }
      trace.counters["event:websocket.emit"] = (trace.counters["event:websocket.emit"] ?? 0) + 1;
    },
    setMetaSend(patch) {
      Object.assign(trace.meta, patch);
    },
    setBot(patch) {
      Object.assign(trace.bot, patch);
    },
    setIds(patch) {
      if (patch.conversationId) trace.conversationId = patch.conversationId;
      if (patch.messageId) trace.messageId = patch.messageId;
    },
    finish(status, errorMessage) {
      trace.status = status === "completed" ? "completed" : "error";
      trace.errorMessage = errorMessage;
      trace.endedAt = new Date().toISOString();
      trace.totalDurationMs = Math.round(
        new Date(trace.endedAt).getTime() - new Date(trace.startedAt).getTime(),
      );
      trace.snapshots.after = captureResourceSnapshot();
      finalizeQuerySummary(trace);
      onFinish(trace);
      return trace;
    },
  };
}

export function getActiveTraceHandle(): ActiveTraceHandle | undefined {
  return als.getStore();
}

export async function runWithActiveTrace<T>(
  handle: ActiveTraceHandle,
  fn: () => Promise<T>,
): Promise<T> {
  return await als.run(handle, fn);
}

export function createTraceHandle(
  trace: MessageProcessingTrace,
  onFinish: (t: MessageProcessingTrace) => void,
): ActiveTraceHandle {
  return buildHandle(trace, onFinish);
}

export async function runWithTraceHandle<T>(
  handle: ActiveTraceHandle,
  fn: () => Promise<T>,
): Promise<T> {
  return await als.run(handle, fn);
}
