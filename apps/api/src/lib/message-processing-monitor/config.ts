import type { MonitorSession } from "./types.js";

export function resolveDeploymentEnvironment(): "development" | "staging" | "production" {
  const explicit = process.env.APP_ENV?.trim().toLowerCase();
  if (explicit === "staging" || explicit === "production" || explicit === "development") {
    return explicit;
  }
  return process.env.NODE_ENV?.trim().toLowerCase() === "production" ? "production" : "development";
}

export function isMessageProcessingMonitorEnabled(): boolean {
  const raw = process.env.MESSAGE_PROCESSING_MONITOR_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export const DEFAULT_MONITOR_SESSION: MonitorSession = {
  active: false,
  passiveMode: true,
  organizationId: null,
  inboxId: null,
  direction: "ALL",
  samplingPercent: 100,
  investigationUntil: null,
  slowQueryThresholdMs: 300,
  thresholds: {
    processCpuPercent: 400,
    serverCpuPercent: 80,
    eventLoopLagMs: 250,
    messageDurationMs: 10_000,
    queriesPerMessage: 100,
    eventsPerMessage: 100,
  },
  startedAt: null,
  startedByUserId: null,
};

export const TRACE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const ANOMALY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TRACES_IN_MEMORY = 2_000;
export const MAX_ANOMALIES_IN_MEMORY = 500;
