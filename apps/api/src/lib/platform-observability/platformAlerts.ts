import { config } from "../../config.js";
import { getAgentEngineQueueDiagnostics } from "../agent-engine/queue/agentEngineQueue.js";
import { getStoreStats } from "../message-processing-monitor/store.js";
import {
  captureResourceSnapshot,
  getLastEventLoopLagMs,
  getPeakMetrics,
} from "../message-processing-monitor/systemMetrics.js";
import { getLatencyMetrics } from "./latencySampler.js";
import { getMetaInboundQueueMetrics } from "../metaInboundQueue.js";

export type PlatformAlertSeverity = "warning" | "critical";

export type PlatformAlert = {
  code: string;
  severity: PlatformAlertSeverity;
  message: string;
  value?: number;
  threshold?: number;
};

export function evaluatePlatformAlerts(input?: {
  processCpuPercent?: number;
  eventLoopLagMs?: number;
}): PlatformAlert[] {
  const snap = captureResourceSnapshot();
  const cpu = input?.processCpuPercent ?? snap.processCpuPercent;
  const lag = input?.eventLoopLagMs ?? getLastEventLoopLagMs();
  const peaks = getPeakMetrics();
  const stats = getStoreStats();
  const queue = getAgentEngineQueueDiagnostics();
  const latency = getLatencyMetrics(15);
  const alerts: PlatformAlert[] = [];

  if (cpu >= config.platformAlertCpuPercent) {
    alerts.push({
      code: "CPU_HIGH",
      severity: cpu >= config.platformAlertCpuPercent * 1.5 ? "critical" : "warning",
      message: `CPU do processo elevada: ${cpu}%`,
      value: cpu,
      threshold: config.platformAlertCpuPercent,
    });
  }

  if (peaks.peakProcessCpuPercent >= config.platformAlertCpuPercent) {
    alerts.push({
      code: "CPU_PEAK_HIGH",
      severity: "warning",
      message: `Pico de CPU na janela: ${peaks.peakProcessCpuPercent}%`,
      value: peaks.peakProcessCpuPercent,
      threshold: config.platformAlertCpuPercent,
    });
  }

  if (lag >= config.platformAlertEventLoopLagMs) {
    alerts.push({
      code: "EVENT_LOOP_LAG",
      severity: lag >= config.platformAlertEventLoopLagMs * 2 ? "critical" : "warning",
      message: `Event loop lag: ${lag}ms`,
      value: lag,
      threshold: config.platformAlertEventLoopLagMs,
    });
  }

  const fallbackRate = queue.metrics.syncFallbackRatePercent;
  if (
    fallbackRate != null &&
    fallbackRate >= config.platformAlertAgentSyncFallbackPercent &&
    queue.metrics.totalDispatchAttempts >= 10
  ) {
    alerts.push({
      code: "AGENT_QUEUE_SYNC_FALLBACK",
      severity: fallbackRate >= config.platformAlertAgentSyncFallbackPercent * 2 ? "critical" : "warning",
      message: `Fallback síncrono da fila agent: ${fallbackRate}%`,
      value: fallbackRate,
      threshold: config.platformAlertAgentSyncFallbackPercent,
    });
  }

  if (!queue.queueOperational && queue.redisUrlConfigured) {
    alerts.push({
      code: "AGENT_QUEUE_DOWN",
      severity: "critical",
      message: "Fila agent-engine indisponível (Redis configurado mas queue não operacional)",
    });
  }

  const inboundP95 = latency.inbound_message.p95Ms;
  if (inboundP95 != null && inboundP95 >= config.platformAlertInboundP95Ms) {
    alerts.push({
      code: "INBOUND_LATENCY_P95",
      severity: "warning",
      message: `P95 inbound (15m): ${inboundP95}ms`,
      value: inboundP95,
      threshold: config.platformAlertInboundP95Ms,
    });
  }

  if (stats.processingNow >= config.platformAlertProcessingNow) {
    alerts.push({
      code: "PROCESSING_BACKLOG",
      severity: "warning",
      message: `${stats.processingNow} mensagens em processamento simultâneo`,
      value: stats.processingNow,
      threshold: config.platformAlertProcessingNow,
    });
  }

  const metaWebhookP95 = latency.meta_webhook_http.p95Ms;
  if (metaWebhookP95 != null && metaWebhookP95 >= config.platformAlertMetaWebhookHttpP95Ms) {
    alerts.push({
      code: "META_WEBHOOK_HTTP_P95",
      severity: "warning",
      message: `P95 HTTP webhook Meta (early 200): ${metaWebhookP95}ms`,
      value: metaWebhookP95,
      threshold: config.platformAlertMetaWebhookHttpP95Ms,
    });
  }

  const metaLagP95 = latency.meta_inbound_queue_lag.p95Ms;
  if (metaLagP95 != null && metaLagP95 >= config.platformAlertMetaInboundLagMs) {
    alerts.push({
      code: "META_INBOUND_QUEUE_LAG",
      severity: "warning",
      message: `P95 lag fila meta-inbound: ${metaLagP95}ms`,
      value: metaLagP95,
      threshold: config.platformAlertMetaInboundLagMs,
    });
  }

  const metaMetrics = getMetaInboundQueueMetrics();
  if (
    metaMetrics.metaRetryRatePercent != null &&
    metaMetrics.metaRetryRatePercent >= 20 &&
    metaMetrics.enqueueDuplicateCount >= 5
  ) {
    alerts.push({
      code: "META_WEBHOOK_RETRY_RATE",
      severity: "warning",
      message: `Taxa de retry/dedupe Meta: ${metaMetrics.metaRetryRatePercent}%`,
      value: metaMetrics.metaRetryRatePercent,
      threshold: 20,
    });
  }

  if (metaMetrics.enqueueFailedCount >= 3) {
    alerts.push({
      code: "META_INBOUND_ENQUEUE_FAILED",
      severity: "critical",
      message: `${metaMetrics.enqueueFailedCount} falhas ao enfileirar webhook Meta`,
      value: metaMetrics.enqueueFailedCount,
      threshold: 3,
    });
  }

  return alerts;
}
