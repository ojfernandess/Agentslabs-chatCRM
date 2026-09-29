import type { MessageProcessingTrace, MonitorSession, TraceAnomaly } from "./types.js";
import { recordLatencySample } from "../platform-observability/latencySampler.js";
import {
  ANOMALY_RETENTION_MS,
  DEFAULT_MONITOR_SESSION,
  MAX_ANOMALIES_IN_MEMORY,
  MAX_TRACES_IN_MEMORY,
  TRACE_RETENTION_MS,
} from "./config.js";

const traces = new Map<string, MessageProcessingTrace>();
const traceOrder: string[] = [];
const anomalies: TraceAnomaly[] = [];
let session: MonitorSession = { ...DEFAULT_MONITOR_SESSION };
let processingNow = 0;
let messagesMonitored = 0;
let errorCount = 0;

function pruneTraces(): void {
  const cutoff = Date.now() - TRACE_RETENTION_MS;
  while (traceOrder.length > MAX_TRACES_IN_MEMORY) {
    const id = traceOrder.shift();
    if (id) traces.delete(id);
  }
  for (const [id, trace] of traces) {
    if (new Date(trace.startedAt).getTime() < cutoff) {
      traces.delete(id);
      const idx = traceOrder.indexOf(id);
      if (idx >= 0) traceOrder.splice(idx, 1);
    }
  }
}

function pruneAnomalies(): void {
  const cutoff = Date.now() - ANOMALY_RETENTION_MS;
  while (anomalies.length > MAX_ANOMALIES_IN_MEMORY) anomalies.shift();
  while (anomalies.length > 0 && new Date(anomalies[0]!.at).getTime() < cutoff) {
    anomalies.shift();
  }
}

export function getMonitorSession(): MonitorSession {
  return { ...session };
}

export function setMonitorSession(patch: Partial<MonitorSession>): MonitorSession {
  session = { ...session, ...patch };
  return getMonitorSession();
}

export function resetMonitorSession(): MonitorSession {
  session = { ...DEFAULT_MONITOR_SESSION };
  return getMonitorSession();
}

export function incrementProcessingNow(delta: number): void {
  processingNow = Math.max(0, processingNow + delta);
}

export function saveTrace(trace: MessageProcessingTrace): void {
  traces.set(trace.traceId, trace);
  traceOrder.push(trace.traceId);
  messagesMonitored += 1;
  if (trace.status === "error") errorCount += 1;
  for (const a of trace.anomalies) {
    anomalies.push({ ...a, meta: { ...a.meta, traceId: trace.traceId } });
  }
  if (trace.totalDurationMs != null) {
    recordLatencySample(
      trace.direction === "OUTBOUND" ? "outbound_message" : "inbound_message",
      trace.totalDurationMs,
    );
  }
  pruneTraces();
  pruneAnomalies();
}

export function getTrace(traceId: string): MessageProcessingTrace | undefined {
  return traces.get(traceId);
}

export function listTraces(filter: {
  organizationId?: string;
  inboxId?: string;
  direction?: "INBOUND" | "OUTBOUND";
  errorsOnly?: boolean;
  limit?: number;
}): MessageProcessingTrace[] {
  const limit = Math.min(filter.limit ?? 100, 500);
  const rows: MessageProcessingTrace[] = [];
  for (let i = traceOrder.length - 1; i >= 0 && rows.length < limit; i--) {
    const t = traces.get(traceOrder[i]!);
    if (!t) continue;
    if (filter.organizationId && t.organizationId !== filter.organizationId) continue;
    if (filter.inboxId && t.inboxId !== filter.inboxId) continue;
    if (filter.direction && t.direction !== filter.direction) continue;
    if (filter.errorsOnly && t.status !== "error") continue;
    rows.push(t);
  }
  return rows;
}

export function listAnomalies(limit = 50): TraceAnomaly[] {
  return anomalies.slice(-limit).reverse();
}

export function getStoreStats(): {
  processingNow: number;
  messagesMonitored: number;
  errors: number;
} {
  return { processingNow, messagesMonitored, errors: errorCount };
}

export function clearMonitorData(): void {
  traces.clear();
  traceOrder.length = 0;
  anomalies.length = 0;
  processingNow = 0;
  messagesMonitored = 0;
  errorCount = 0;
}
