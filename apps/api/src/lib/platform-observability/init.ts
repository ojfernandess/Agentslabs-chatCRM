import { startSystemMetricsSampler } from "../message-processing-monitor/systemMetrics.js";

/** Fase B5 — sampler de CPU/lag sempre activo para health e alertas. */
export function initPlatformObservability(): void {
  startSystemMetricsSampler(5_000);
}
