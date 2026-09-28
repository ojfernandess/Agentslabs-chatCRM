import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import {
  getBottlenecks,
  getMonitorOverview,
  getTrace,
  listAnomalies,
  listTraces,
  startInvestigationSession,
  stopInvestigationSession,
} from "../lib/message-processing-monitor/index.js";
import { getMonitorSession, setMonitorSession } from "../lib/message-processing-monitor/store.js";
import { isMessageProcessingMonitorEnabled } from "../lib/message-processing-monitor/config.js";
import type { MessageProcessingTrace } from "../lib/message-processing-monitor/types.js";

const tracesQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  inboxId: z.string().uuid().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  errorsOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
  fetchFailedOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  windowMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
});

const startSessionSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  inboxId: z.string().uuid().nullable().optional(),
  direction: z.enum(["ALL", "INBOUND", "OUTBOUND"]).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(60),
  samplingPercent: z.coerce.number().min(1).max(100).optional(),
});

const thresholdsSchema = z.object({
  processCpuPercent: z.number().min(50).max(2000).optional(),
  serverCpuPercent: z.number().min(10).max(100).optional(),
  eventLoopLagMs: z.number().min(10).max(10_000).optional(),
  messageDurationMs: z.number().min(1000).max(600_000).optional(),
  queriesPerMessage: z.number().min(10).max(10_000).optional(),
  eventsPerMessage: z.number().min(10).max(10_000).optional(),
  slowQueryThresholdMs: z.number().min(50).max(30_000).optional(),
  samplingPercent: z.number().min(1).max(100).optional(),
});

function filterTracesByWindow(traces: MessageProcessingTrace[], windowMinutes?: number): MessageProcessingTrace[] {
  if (!windowMinutes) return traces;
  const cutoff = Date.now() - windowMinutes * 60_000;
  return traces.filter((t) => new Date(t.startedAt).getTime() >= cutoff);
}

function matchesFetchFailed(trace: MessageProcessingTrace): boolean {
  const err = trace.errorMessage ?? trace.meta.lastError ?? "";
  const hay = err.toLowerCase();
  return (
    hay.includes("fetch failed") ||
    hay.includes("etimedout") ||
    hay.includes("econnreset") ||
    hay.includes("und_err_connect_timeout") ||
    hay.includes("meta_missing_message_id") ||
    hay.includes("sem wamid")
  );
}

function traceToCsvRow(trace: MessageProcessingTrace): string {
  const cols = [
    trace.traceId,
    trace.environment,
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
    trace.errorMessage ?? trace.meta.lastError ?? "",
  ];
  return cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
}

export async function superMessageProcessingMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/message-processing/status", async () => ({
    enabled: isMessageProcessingMonitorEnabled(),
    overview: getMonitorOverview(),
  }));

  app.get("/message-processing/traces", async (request) => {
    const parsed = tracesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return { error: parsed.error.message, traces: [] };
    }
    let traces = listTraces({
      organizationId: parsed.data.organizationId,
      inboxId: parsed.data.inboxId,
      direction: parsed.data.direction,
      errorsOnly: parsed.data.errorsOnly,
      limit: parsed.data.limit ?? 100,
    });
    traces = filterTracesByWindow(traces, parsed.data.windowMinutes);
    if (parsed.data.fetchFailedOnly) {
      traces = traces.filter(matchesFetchFailed);
    }
    return { traces };
  });

  app.get("/message-processing/traces/:traceId", async (request, reply) => {
    const { traceId } = request.params as { traceId: string };
    const trace = getTrace(traceId);
    if (!trace) {
      return reply.status(404).send({
        error: "Not Found",
        message: "Trace not found",
        statusCode: 404,
      });
    }
    return { trace };
  });

  app.get("/message-processing/traces/:traceId/export", async (request, reply) => {
    const { traceId } = request.params as { traceId: string };
    const format = (request.query as { format?: string }).format ?? "json";
    const trace = getTrace(traceId);
    if (!trace) {
      return reply.status(404).send({
        error: "Not Found",
        message: "Trace not found",
        statusCode: 404,
      });
    }
    if (format === "csv") {
      const header =
        "traceId,environment,direction,organizationId,inboxId,provider,status,startedAt,endedAt,totalDurationMs,peakCpuPercent,peakEventLoopLagMs,queries,realtimeEmits,error";
      const body = `${header}\n${traceToCsvRow(trace)}`;
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${trace.traceId}.csv"`);
      return body;
    }
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${trace.traceId}.json"`);
    return trace;
  });

  app.get("/message-processing/compare", async (request, reply) => {
    const q = request.query as { a?: string; b?: string };
    if (!q.a || !q.b) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Query params a and b (traceId) are required",
        statusCode: 400,
      });
    }
    const traceA = getTrace(q.a);
    const traceB = getTrace(q.b);
    if (!traceA || !traceB) {
      return reply.status(404).send({
        error: "Not Found",
        message: "One or both traces not found",
        statusCode: 404,
      });
    }
    return { a: traceA, b: traceB };
  });

  app.get("/message-processing/anomalies", async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    return { anomalies: listAnomalies(Math.min(limit, 200)) };
  });

  app.get("/message-processing/bottlenecks", async (request) => {
    const windowMinutes = Number((request.query as { windowMinutes?: string }).windowMinutes ?? 60);
    return getBottlenecks(Math.min(windowMinutes, 10_080));
  });

  app.post("/message-processing/session/start", async (request) => {
    const parsed = startSessionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const userId =
      typeof request.user === "object" && request.user !== null && "sub" in request.user
        ? String((request.user as { sub: string }).sub)
        : null;
    const session = startInvestigationSession({
      organizationId: parsed.data.organizationId ?? null,
      inboxId: parsed.data.inboxId ?? null,
      direction: parsed.data.direction ?? "ALL",
      durationMinutes: parsed.data.durationMinutes,
      samplingPercent: parsed.data.samplingPercent,
      userId,
    });
    return { ok: true, session };
  });

  app.post("/message-processing/session/stop", async () => {
    const session = stopInvestigationSession();
    return { ok: true, session };
  });

  app.patch("/message-processing/session", async (request) => {
    const parsed = thresholdsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const current = getMonitorSession();
    const patch: Partial<typeof current> = {};
    if (parsed.data.samplingPercent !== undefined) patch.samplingPercent = parsed.data.samplingPercent;
    if (parsed.data.slowQueryThresholdMs !== undefined) {
      patch.slowQueryThresholdMs = parsed.data.slowQueryThresholdMs;
    }
    const thresholds = { ...current.thresholds };
    for (const key of [
      "processCpuPercent",
      "serverCpuPercent",
      "eventLoopLagMs",
      "messageDurationMs",
      "queriesPerMessage",
      "eventsPerMessage",
    ] as const) {
      if (parsed.data[key] !== undefined) thresholds[key] = parsed.data[key]!;
    }
    patch.thresholds = thresholds;
    const session = setMonitorSession(patch);
    return { ok: true, session };
  });

  app.get("/message-processing/organizations", async () => {
    const orgs = await prisma.organization.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        inboxes: {
          where: { channelType: "WHATSAPP" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, channelType: true },
        },
      },
    });
    return { organizations: orgs };
  });
}
