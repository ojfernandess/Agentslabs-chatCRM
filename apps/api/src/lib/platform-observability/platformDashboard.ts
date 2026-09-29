import { config } from "../../config.js";
import { getAgentEngineQueueDiagnostics } from "../agent-engine/queue/agentEngineQueue.js";
import { getMetaInboundQueueDiagnostics } from "../metaInboundQueue.js";
import { getMonitorOverview } from "../message-processing-monitor/service.js";
import { getWorkspaceHubStats } from "../workspaceHub.js";
import { evaluatePlatformAlerts } from "./platformAlerts.js";
import { getLatencyMetrics } from "./latencySampler.js";

export async function getPlatformObservabilityDashboard(windowMinutes = 60) {
  const latency = getLatencyMetrics(windowMinutes);
  const alerts = evaluatePlatformAlerts();
  const metaInboundQueue = await getMetaInboundQueueDiagnostics();
  return {
    generatedAt: new Date().toISOString(),
    processRole: config.processRole,
    windowMinutes,
    latency,
    /** TTFR bot ≈ inbound_message; webhook Meta ≈ meta_webhook_http; lag fila ≈ meta_inbound_queue_lag */
    productionSlo: {
      metaWebhookHttpP95Ms: latency.meta_webhook_http.p95Ms,
      metaInboundQueueLagP95Ms: latency.meta_inbound_queue_lag.p95Ms,
      botInboundP95Ms: latency.inbound_message.p95Ms,
      agentSyncFallbackRatePercent:
        getAgentEngineQueueDiagnostics().metrics.syncFallbackRatePercent,
      metaWebhookRetryRatePercent: metaInboundQueue.metrics.metaRetryRatePercent,
    },
    alerts,
    alertCount: alerts.length,
    workspace: getWorkspaceHubStats(),
    agentEngineQueue: getAgentEngineQueueDiagnostics(),
    metaInboundQueue,
    monitor: getMonitorOverview(),
  };
}

/** Extensão leve para `/health` e worker health. */
export function getPlatformHealthExtension() {
  const latency = getLatencyMetrics(15);
  const alerts = evaluatePlatformAlerts();
  return {
    latencyP50Ms: {
      inbound: latency.inbound_message.p50Ms,
      outbound: latency.outbound_message.p50Ms,
    },
    latencyP95Ms: {
      inbound: latency.inbound_message.p95Ms,
      outbound: latency.outbound_message.p95Ms,
    },
    alerts: alerts.map((a) => ({ code: a.code, severity: a.severity, message: a.message })),
    alertCount: alerts.length,
    status: alerts.some((a) => a.severity === "critical") ? "degraded" : "ok",
  };
}
