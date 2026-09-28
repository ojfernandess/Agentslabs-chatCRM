import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearMonitorData,
  getTrace,
  listTraces,
  saveTrace,
  setMonitorSession,
} from "./store.js";
import type { MessageProcessingTrace } from "./types.js";
import { DEFAULT_MONITOR_SESSION } from "./config.js";

function makeTrace(id: string): MessageProcessingTrace {
  const snap = {
    at: new Date().toISOString(),
    processCpuPercent: 10,
    serverCpuPercent: 5,
    processMemoryMb: 100,
    serverMemoryUsedMb: 1000,
    serverMemoryTotalMb: 2000,
    heapUsedMb: 50,
    heapTotalMb: 80,
    rssMb: 100,
    eventLoopLagMs: 5,
    eventLoopUtilization: 10,
  };
  return {
    traceId: id,
    environment: "development",
    direction: "INBOUND",
    organizationId: "org-1",
    status: "completed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    totalDurationMs: 120,
    snapshots: { before: snap, peak: snap },
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
}

describe("message-processing-monitor store", () => {
  beforeEach(() => {
    clearMonitorData();
    setMonitorSession({ ...DEFAULT_MONITOR_SESSION });
  });

  it("stores and lists traces", () => {
    saveTrace(makeTrace("MSG-TEST-1"));
    assert.equal(getTrace("MSG-TEST-1")?.traceId, "MSG-TEST-1");
    assert.equal(listTraces({ limit: 10 }).length, 1);
  });

  it("filters traces by organization", () => {
    saveTrace(makeTrace("MSG-A"));
    const other = makeTrace("MSG-B");
    other.organizationId = "org-2";
    saveTrace(other);
    assert.equal(listTraces({ organizationId: "org-1" }).length, 1);
  });
});
