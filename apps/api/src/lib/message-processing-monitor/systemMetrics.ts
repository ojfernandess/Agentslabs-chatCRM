import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import type { ResourceSnapshot } from "./types.js";

const CPU_CORES = os.cpus().length || 1;
let lastCpuUsage = process.cpuUsage();
let lastCpuAt = performance.now();
let lastEventLoopLagMs = 0;
let lastEventLoopUtilization: number | null = null;

const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopMonitor.enable();

let metricsTimer: ReturnType<typeof setInterval> | null = null;
let peakProcessCpuPercent = 0;
let peakEventLoopLagMs = 0;

function readProcessCpuPercent(): number {
  const now = performance.now();
  const elapsedMs = now - lastCpuAt;
  if (elapsedMs <= 0) return 0;
  const usage = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  lastCpuAt = now;
  const cpuMs = (usage.user + usage.system) / 1000;
  return Math.round((cpuMs / elapsedMs) * 100);
}

export function captureResourceSnapshot(): ResourceSnapshot {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const processCpuPercent = readProcessCpuPercent();
  const lagMs = Math.round(eventLoopMonitor.mean / 1e6);
  eventLoopMonitor.reset();

  let elu: number | null = null;
  try {
    const util = performance.eventLoopUtilization();
    elu = Math.round(util.utilization * 1000) / 10;
    lastEventLoopUtilization = elu;
  } catch {
    elu = lastEventLoopUtilization;
  }

  lastEventLoopLagMs = lagMs;
  if (processCpuPercent > peakProcessCpuPercent) peakProcessCpuPercent = processCpuPercent;
  if (lagMs > peakEventLoopLagMs) peakEventLoopLagMs = lagMs;

  const serverUsedMb = Math.round((totalMem - freeMem) / (1024 * 1024));
  const serverTotalMb = Math.round(totalMem / (1024 * 1024));
  const serverCpuPercent =
    process.platform === "linux"
      ? Math.min(100, Math.round((processCpuPercent / CPU_CORES) * 10) / 10)
      : null;

  return {
    at: new Date().toISOString(),
    processCpuPercent,
    serverCpuPercent,
    processMemoryMb: Math.round(mem.rss / (1024 * 1024)),
    serverMemoryUsedMb: serverUsedMb,
    serverMemoryTotalMb: serverTotalMb,
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    eventLoopLagMs: lagMs,
    eventLoopUtilization: elu,
  };
}

export function getCpuCoreCount(): number {
  return CPU_CORES;
}

export function getPeakMetrics(): { peakProcessCpuPercent: number; peakEventLoopLagMs: number } {
  return { peakProcessCpuPercent, peakEventLoopLagMs };
}

export function resetPeakMetrics(): void {
  peakProcessCpuPercent = 0;
  peakEventLoopLagMs = 0;
}

export function startSystemMetricsSampler(intervalMs = 2000): void {
  if (metricsTimer) return;
  metricsTimer = setInterval(() => {
    captureResourceSnapshot();
  }, intervalMs);
  metricsTimer.unref?.();
}

export function getLastEventLoopLagMs(): number {
  return lastEventLoopLagMs;
}
