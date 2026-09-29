export type ExportableMessageTrace = {
  traceId: string;
  environment?: string;
  direction: "INBOUND" | "OUTBOUND";
  organizationId: string;
  organizationName?: string;
  inboxId?: string;
  inboxName?: string;
  provider?: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs?: number;
  errorMessage?: string;
  snapshots: {
    peak: { processCpuPercent: number; eventLoopLagMs: number };
  };
  spans: Array<{ stage: string; label: string; startedAt: string; durationMs: number; cpuDeltaPercent: number }>;
  querySummary: {
    total: number;
    totalDurationMs?: number;
    slowestMs?: number;
    repeatedPatterns: Array<{ pattern: string; count: number }>;
  };
  realtime: { emits: number; recipients?: number; payloadBytes?: number };
  bot?: { triggered: boolean; durationMs?: number };
  meta?: { sendAttempts?: number; lastError?: string; wamid?: string };
  anomalies: Array<{ code: string; severity: string; message: string }>;
  events?: Array<{ name: string; count: number }>;
};

function escapeCsv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function traceToCsvRow(trace: ExportableMessageTrace): string {
  const cols = [
    trace.traceId,
    trace.environment ?? "",
    trace.direction,
    trace.organizationId,
    trace.inboxId ?? "",
    trace.provider ?? "",
    trace.status,
    trace.startedAt,
    trace.endedAt ?? "",
    String(trace.totalDurationMs ?? ""),
    String(trace.snapshots.peak.processCpuPercent),
    String(trace.snapshots.peak.eventLoopLagMs),
    String(trace.querySummary.total),
    String(trace.realtime.emits),
    trace.errorMessage ?? trace.meta?.lastError ?? "",
  ];
  return cols.map(escapeCsv).join(",");
}

const CSV_HEADER =
  "traceId,environment,direction,organizationId,inboxId,provider,status,startedAt,endedAt,totalDurationMs,peakCpuPercent,peakEventLoopLagMs,queries,realtimeEmits,error";

export function buildTracesCsv(traces: ExportableMessageTrace[]): string {
  if (traces.length === 0) return CSV_HEADER;
  return `${CSV_HEADER}\n${traces.map(traceToCsvRow).join("\n")}`;
}

export function buildTraceMarkdown(trace: ExportableMessageTrace): string {
  const lines: string[] = [
    `# ${trace.traceId}`,
    "",
    `| Campo | Valor |`,
    `| --- | --- |`,
    `| Direção | ${trace.direction} |`,
    `| Status | ${trace.status} |`,
    `| Início | ${trace.startedAt} |`,
    `| Duração | ${trace.totalDurationMs ?? "—"} ms |`,
    `| CPU pico | ${trace.snapshots.peak.processCpuPercent}% |`,
    `| Event loop lag | ${trace.snapshots.peak.eventLoopLagMs} ms |`,
    `| Queries | ${trace.querySummary.total} |`,
    `| Realtime emits | ${trace.realtime.emits} |`,
    `| Provider | ${trace.provider ?? "—"} |`,
    `| Organização | ${trace.organizationName ?? trace.organizationId} |`,
    `| Inbox | ${trace.inboxName ?? trace.inboxId ?? "—"} |`,
  ];

  if (trace.errorMessage || trace.meta?.lastError) {
    lines.push(`| Erro | ${trace.errorMessage ?? trace.meta?.lastError} |`);
  }

  if (trace.spans.length > 0) {
    lines.push("", "## Timeline", "");
    for (const span of trace.spans) {
      lines.push(
        `- **${span.label}** (\`${span.stage}\`) — ${span.durationMs}ms, CPU +${span.cpuDeltaPercent}% @ ${span.startedAt}`,
      );
    }
  }

  if (trace.querySummary.repeatedPatterns.length > 0) {
    lines.push("", "## Queries repetidas", "");
    for (const p of trace.querySummary.repeatedPatterns) {
      lines.push(`- ${p.pattern}: ${p.count}x`);
    }
  }

  if (trace.anomalies.length > 0) {
    lines.push("", "## Anomalias", "");
    for (const a of trace.anomalies) {
      lines.push(`- [${a.severity}] ${a.code}: ${a.message}`);
    }
  }

  return lines.join("\n");
}

export function buildTracesMarkdown(traces: ExportableMessageTrace[]): string {
  return traces.map(buildTraceMarkdown).join("\n\n---\n\n");
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export type TraceExportFormat = "json" | "csv" | "markdown";

export function serializeTraces(traces: ExportableMessageTrace[], format: TraceExportFormat): {
  text: string;
  mime: string;
  ext: string;
} {
  if (format === "json") {
    return {
      text: JSON.stringify(traces.length === 1 ? traces[0] : traces, null, 2),
      mime: "application/json;charset=utf-8",
      ext: "json",
    };
  }
  if (format === "csv") {
    return {
      text: buildTracesCsv(traces),
      mime: "text/csv;charset=utf-8",
      ext: "csv",
    };
  }
  return {
    text: buildTracesMarkdown(traces),
    mime: "text/markdown;charset=utf-8",
    ext: "md",
  };
}
