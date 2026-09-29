import type { MessageDirection, MessageProcessingTrace, MonitorSession } from "./types.js";
import {
  getMonitorSession,
  incrementProcessingNow,
  listAnomalies,
  listTraces,
  saveTrace,
  getStoreStats,
  setMonitorSession,
} from "./store.js";
import {
  captureResourceSnapshot,
  getCpuCoreCount,
  getPeakMetrics,
  resetPeakMetrics,
  startSystemMetricsSampler,
} from "./systemMetrics.js";
import {
  createTraceHandle,
  generateTraceId,
  getActiveTraceHandle,
  runWithTraceHandle,
  type ActiveTraceHandle,
} from "./traceContext.js";
import {
  DEFAULT_MONITOR_SESSION,
  isMessageProcessingMonitorEnabled,
  resolveDeploymentEnvironment,
} from "./config.js";
import { getAgentEngineQueueDiagnostics } from "../agent-engine/queue/agentEngineQueue.js";

const traceById = new Map<string, ActiveTraceHandle>();

export function initMessageProcessingMonitor(): void {
  if (!isMessageProcessingMonitorEnabled()) return;
  startSystemMetricsSampler(2000);
}

function shouldSampleTrace(): boolean {
  const session = getMonitorSession();
  if (!session.active) return false;
  if (session.investigationUntil && new Date(session.investigationUntil).getTime() < Date.now()) {
    setMonitorSession({ active: false, investigationUntil: null });
    return false;
  }
  if (session.samplingPercent >= 100) return true;
  return Math.random() * 100 < session.samplingPercent;
}

function matchesSessionFilters(input: {
  organizationId: string;
  inboxId?: string;
  direction: MessageDirection;
}): boolean {
  const session = getMonitorSession();
  if (session.organizationId && session.organizationId !== input.organizationId) return false;
  if (session.inboxId && input.inboxId && session.inboxId !== input.inboxId) return false;
  if (session.direction !== "ALL" && session.direction !== input.direction) return false;
  return true;
}

function analyzeTraceAnomalies(trace: MessageProcessingTrace): void {
  const session = getMonitorSession();
  const peakCpu = trace.snapshots.peak.processCpuPercent;
  if (peakCpu >= session.thresholds.processCpuPercent) {
    trace.anomalies.push({
      code: "CPU_CRITICAL",
      severity: "critical",
      message: `CPU do processo observada durante o trace: ${peakCpu}%`,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
  if (trace.snapshots.peak.eventLoopLagMs >= session.thresholds.eventLoopLagMs) {
    trace.anomalies.push({
      code: "EVENT_LOOP_LAG",
      severity: "warning",
      message: `Event loop lag observado: ${trace.snapshots.peak.eventLoopLagMs}ms`,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
  if ((trace.totalDurationMs ?? 0) >= session.thresholds.messageDurationMs) {
    trace.anomalies.push({
      code: "SLOW_MESSAGE",
      severity: "warning",
      message: `Processamento lento: ${trace.totalDurationMs}ms`,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
  if (trace.querySummary.total >= session.thresholds.queriesPerMessage) {
    trace.anomalies.push({
      code: "HIGH_QUERY_COUNT",
      severity: "warning",
      message: `${trace.querySummary.total} queries durante 1 mensagem`,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
  const topRepeat = trace.querySummary.repeatedPatterns[0];
  if (topRepeat && topRepeat.count >= 10) {
    trace.anomalies.push({
      code: "POSSIBLE_N_PLUS_ONE",
      severity: "warning",
      message: `Possível N+1: ${topRepeat.pattern} executada ${topRepeat.count} vezes`,
      at: trace.endedAt ?? new Date().toISOString(),
      meta: { pattern: topRepeat.pattern, count: topRepeat.count },
    });
  }
  const convUpdated = trace.counters["event:conversation.updated"] ?? 0;
  if (convUpdated >= 20) {
    trace.anomalies.push({
      code: "EVENT_STORM",
      severity: "critical",
      message: `conversation.updated emitido ${convUpdated} vezes durante o trace`,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
  const wsEmits = trace.realtime.emits;
  if (wsEmits >= session.thresholds.eventsPerMessage) {
    trace.anomalies.push({
      code: "REALTIME_EXCESS",
      severity: "warning",
      message: `${wsEmits} emissões realtime durante 1 mensagem`,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
  for (const ev of trace.events) {
    const windowMs = trace.totalDurationMs ?? 0;
    if (ev.count >= 50 && windowMs > 0 && windowMs <= 10_000) {
      trace.anomalies.push({
        code: "POSSIBLE_EVENT_LOOP",
        severity: "critical",
        message: `Possível loop: ${ev.name} executado ${ev.count} vezes em ${Math.round(windowMs)}ms`,
        at: trace.endedAt ?? new Date().toISOString(),
        meta: { event: ev.name, count: ev.count, windowMs: Math.round(windowMs) },
      });
      break;
    }
  }
  if (trace.meta.lastError?.includes("ETIMEDOUT") || trace.meta.lastError?.includes("fetch failed")) {
    trace.anomalies.push({
      code: "META_FETCH_FAILED",
      severity: "warning",
      message: trace.meta.lastError,
      at: trace.endedAt ?? new Date().toISOString(),
    });
  }
}

export type StartTraceInput = {
  direction: MessageDirection;
  organizationId: string;
  organizationName?: string;
  inboxId?: string;
  inboxName?: string;
  provider?: string;
  providerMessageId?: string;
  messageType?: string;
  bodyLength?: number;
};

export function maybeStartMessageTrace(input: StartTraceInput): ActiveTraceHandle | null {
  if (!isMessageProcessingMonitorEnabled()) return null;
  if (!shouldSampleTrace()) return null;
  if (!matchesSessionFilters(input)) return null;

  const before = captureResourceSnapshot();
  const trace: MessageProcessingTrace = {
    traceId: generateTraceId(),
    environment: resolveDeploymentEnvironment(),
    direction: input.direction,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    inboxId: input.inboxId,
    inboxName: input.inboxName,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    messageType: input.messageType,
    bodyLength: input.bodyLength,
    status: "processing",
    startedAt: new Date().toISOString(),
    snapshots: { before, peak: { ...before } },
    spans: [],
    queries: [],
    querySummary: { total: 0, totalDurationMs: 0, slowestMs: 0, repeatedPatterns: [] },
    events: [],
    realtime: { emits: 0, recipients: 0, payloadBytes: 0 },
    bot: { triggered: false },
    meta: { sendAttempts: 0 },
    anomalies: [],
    counters: {},
  };

  incrementProcessingNow(1);
  const handle = createTraceHandle(trace, (finished) => {
    analyzeTraceAnomalies(finished);
    saveTrace(finished);
    traceById.delete(finished.traceId);
    incrementProcessingNow(-1);
  });
  traceById.set(trace.traceId, handle);
  handle.stage("webhook_received", "Webhook / ingest recebido");
  return handle;
}

export function getTraceHandleById(traceId: string): ActiveTraceHandle | undefined {
  return traceById.get(traceId) ?? (getActiveTraceHandle()?.trace.traceId === traceId ? getActiveTraceHandle() : undefined);
}

export async function runWithMessageTrace<T>(
  input: StartTraceInput,
  fn: (handle: ActiveTraceHandle | null) => Promise<T>,
): Promise<T> {
  const handle = maybeStartMessageTrace(input);
  if (!handle) return await fn(null);
  try {
    const result = await runWithTraceHandle(handle, async () => await fn(handle));
    handle.finish("completed");
    return result;
  } catch (err) {
    handle.finish("error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function deferMessageTraceFinish(handle: ActiveTraceHandle | null | undefined): void {
  if (!handle) return;
  handle.deferredFinish = true;
}

export function finishMessageTrace(
  handle: ActiveTraceHandle | null | undefined,
  status: "completed" | "error" = "completed",
  errorMessage?: string,
): void {
  if (!handle) return;
  if (handle.deferredFinish) return;
  handle.finish(status, errorMessage);
}

/** Fecha trace inbound adiado após o turno completo do bot (ou enfileiramento BullMQ). */
export function completeDeferredMessageTrace(
  handle: ActiveTraceHandle | null | undefined,
  status: "completed" | "error" = "completed",
  errorMessage?: string,
): void {
  if (!handle) return;
  if (!handle.deferredFinish) return;
  handle.deferredFinish = false;
  handle.finish(status, errorMessage);
}

export function recordPrismaQuery(model: string, action: string, durationMs: number): void {
  const handle = getActiveTraceHandle();
  if (!handle) return;
  handle.recordQuery(model, action, durationMs);
  const session = getMonitorSession();
  if (durationMs >= session.slowQueryThresholdMs) {
    handle.addAnomaly("SLOW_QUERY", "warning", `Query lenta ${model}.${action}: ${Math.round(durationMs)}ms`, {
      model,
      action,
      durationMs: Math.round(durationMs),
    });
  }
}

export function recordMetaSendOutcome(input: {
  durationMs: number;
  httpStatus?: number;
  wamid?: string;
  error?: string;
}): void {
  const handle = getActiveTraceHandle();
  if (!handle) return;
  handle.stage("meta_send", "Chamada Meta Cloud API", {
    durationMs: Math.round(input.durationMs),
    httpStatus: input.httpStatus ?? null,
    hasWamid: Boolean(input.wamid),
  });
  handle.setMetaSend({
    sendAttempts: (handle.trace.meta.sendAttempts ?? 0) + 1,
    lastHttpStatus: input.httpStatus,
    wamid: input.wamid,
    lastError: input.error,
  });
  if (input.error) {
    handle.addAnomaly("META_SEND_ERROR", "warning", input.error);
  }
}

export function recordWorkspaceRealtimeEmit(
  organizationId: string,
  eventType: string,
  payload: unknown,
  recipientCount: number,
): void {
  const handle = getActiveTraceHandle();
  if (!handle) return;
  const raw = JSON.stringify(payload);
  handle.recordRealtimeEmit(recipientCount, raw.length);
  handle.recordEvent(eventType);
  if (eventType === "conversation.updated") {
    handle.increment("conversation.updated.emits");
  }
}

export function getMonitorOverview() {
  const session = getMonitorSession();
  const stats = getStoreStats();
  const peaks = getPeakMetrics();
  const snap = captureResourceSnapshot();
  return {
    environment: resolveDeploymentEnvironment(),
    agentEngineQueue: getAgentEngineQueueDiagnostics(),
    session,
    system: {
      ...snap,
      cpuCores: getCpuCoreCount(),
      processingNow: stats.processingNow,
      messagesMonitored: stats.messagesMonitored,
      errors: stats.errors,
      peakProcessCpuPercent: peaks.peakProcessCpuPercent,
      peakEventLoopLagMs: peaks.peakEventLoopLagMs,
    },
  };
}

export function startInvestigationSession(input: {
  organizationId?: string | null;
  inboxId?: string | null;
  direction?: "ALL" | MessageDirection;
  durationMinutes: number;
  samplingPercent?: number;
  userId?: string | null;
}): MonitorSession {
  const until = new Date(Date.now() + input.durationMinutes * 60_000).toISOString();
  resetPeakMetrics();
  return setMonitorSession({
    active: true,
    passiveMode: true,
    organizationId: input.organizationId ?? null,
    inboxId: input.inboxId ?? null,
    direction: input.direction ?? "ALL",
    samplingPercent: input.samplingPercent ?? 100,
    investigationUntil: until,
    startedAt: new Date().toISOString(),
    startedByUserId: input.userId ?? null,
  });
}

export function stopInvestigationSession(): MonitorSession {
  return setMonitorSession({
    active: false,
    investigationUntil: null,
  });
}

export function getBottlenecks(windowMinutes = 60) {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const traces = listTraces({ limit: 500 }).filter(
    (t) => new Date(t.startedAt).getTime() >= cutoff && t.status === "completed",
  );
  const stageTotals = new Map<string, number>();
  let totalMs = 0;
  for (const t of traces) {
    totalMs += t.totalDurationMs ?? 0;
    for (const s of t.spans) {
      stageTotals.set(s.stage, (stageTotals.get(s.stage) ?? 0) + s.durationMs);
    }
    if (t.bot.triggered && t.bot.durationMs) {
      stageTotals.set("bot", (stageTotals.get("bot") ?? 0) + t.bot.durationMs);
    }
  }
  const entries = [...stageTotals.entries()]
    .map(([stage, ms]) => ({
      stage,
      totalMs: Math.round(ms),
      percent: totalMs > 0 ? Math.round((ms / totalMs) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
  return { windowMinutes, tracesAnalyzed: traces.length, stages: entries };
}

export { listTraces, listAnomalies, DEFAULT_MONITOR_SESSION };
export { runWithTraceHandle } from "./traceContext.js";
export { getTrace } from "./store.js";
