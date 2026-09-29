import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTracesCsv, buildTracesMarkdown, serializeTraces, type ExportableMessageTrace } from "./messageProcessingExport.js";

const sample: ExportableMessageTrace = {
  traceId: "MSG-20260101-1200-ABC",
  direction: "OUTBOUND",
  organizationId: "org-1",
  status: "completed",
  startedAt: "2026-01-01T12:00:00.000Z",
  totalDurationMs: 1200,
  snapshots: { peak: { processCpuPercent: 120, eventLoopLagMs: 45 } },
  spans: [
    {
      stage: "meta_send",
      label: "Envio Meta",
      startedAt: "2026-01-01T12:00:01.000Z",
      durationMs: 900,
      cpuDeltaPercent: 30,
    },
  ],
  querySummary: { total: 12, repeatedPatterns: [{ pattern: "Inbox.findFirst", count: 3 }] },
  realtime: { emits: 2 },
  anomalies: [{ code: "slow_stage", severity: "warning", message: "meta_send lento" }],
};

describe("messageProcessingExport", () => {
  it("builds csv with header and escaped values", () => {
    const csv = buildTracesCsv([sample]);
    assert.match(csv, /^traceId,environment,direction/);
    assert.match(csv, /MSG-20260101-1200-ABC/);
    assert.match(csv, /OUTBOUND/);
  });

  it("builds markdown with timeline and anomalies", () => {
    const md = buildTracesMarkdown([sample]);
    assert.match(md, /# MSG-20260101-1200-ABC/);
    assert.match(md, /Envio Meta/);
    assert.match(md, /meta_send lento/);
  });

  it("serializes json as single object for one trace", () => {
    const { text, ext } = serializeTraces([sample], "json");
    assert.equal(ext, "json");
    const parsed = JSON.parse(text) as ExportableMessageTrace;
    assert.equal(parsed.traceId, sample.traceId);
  });
});
