import { FastifyInstance } from "fastify";
import { z } from "zod";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { businessMinutesBetween, parseTeamBusinessHours, type ParsedBusinessSchedule } from "../lib/businessHours.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { resolveAgentBotFromOrgSettingsRow } from "../lib/agentBotTriage.js";
import {
  analyzeAggregateHealth,
  analyzeConversationForInsights,
  buildPublicConversationTranscript,
  getAssistOpenAiCredentialsForOrganization,
} from "../lib/agentAssistLlm.js";
import { clientIp, recordAuditLog } from "../lib/audit.js";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).optional(),
});

type Granularity = "day" | "week" | "month";

function parseGranularity(v: string | undefined): Granularity {
  if (v === "week" || v === "month") return v;
  return "day";
}

function truncExpr(tableAlias: string, column: string, g: Granularity): string {
  const u = g === "month" ? "month" : g === "week" ? "week" : "day";
  return `date_trunc('${u}', ${tableAlias}.${column})`;
}

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request) => {
    await request.jwtVerify();
  });

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const q = querySchema.safeParse(request.query);
    if (!q.success) {
      return reply.status(400).send({ error: "Bad Request", message: q.error.message, statusCode: 400 });
    }

    const now = new Date();
    const defaultTo = endOfDay(now);
    const defaultFrom = startOfDay(subDays(now, 29));
    const from = q.data.from ? new Date(q.data.from) : defaultFrom;
    const to = q.data.to ? new Date(q.data.to) : defaultTo;
    if (from > to) {
      return reply.status(400).send({ error: "Bad Request", message: "`from` must be before `to`", statusCode: 400 });
    }

    const granularity = parseGranularity(q.data.granularity);
    const truncC = truncExpr("c", "created_at", granularity);
    const truncM = truncExpr("m", "sent_at", granularity);
    const truncR = truncExpr("c", "updated_at", granularity);

    const org = organizationId;

    const [
      openCount,
      pendingCount,
      createdInRange,
      resolvedInRange,
      inboundMsg,
      outboundMsg,
      resolutionAvg,
      firstResponsePairs,
      teamsForBusinessHours,
      createdRows,
      resolvedRows,
      inboundRows,
      outboundRows,
      agentRows,
      teamRows,
      leadTypeRows,
      heatmapRows,
      tagRows,
      csatAggRows,
      csatDistRows,
      outboundBotBucketRows,
      outboundHumanActorBucketRows,
      botOutboundTotalRows,
      humanOutboundTotalRows,
      conversationsWithBotOutboundRows,
      handoffEventsRows,
      handoffsToHumanRows,
      pendingBotQueueCount,
    ] = await Promise.all([
      prisma.conversation.count({ where: { organizationId: org, status: "OPEN" } }),
      prisma.conversation.count({ where: { organizationId: org, status: "PENDING" } }),
      prisma.conversation.count({
        where: { organizationId: org, createdAt: { gte: from, lte: to } },
      }),
      prisma.conversation.count({
        where: {
          organizationId: org,
          status: "RESOLVED",
          updatedAt: { gte: from, lte: to },
        },
      }),
      prisma.message.count({
        where: {
          direction: "INBOUND",
          isPrivate: false,
          sentAt: { gte: from, lte: to },
          conversation: { organizationId: org },
        },
      }),
      prisma.message.count({
        where: {
          direction: "OUTBOUND",
          isPrivate: false,
          sentAt: { gte: from, lte: to },
          conversation: { organizationId: org },
        },
      }),
      prisma.$queryRaw<Array<{ minutes: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (c.updated_at - c.created_at)) / 60.0)::float AS minutes
        FROM conversations c
        WHERE c.organization_id = ${org}::uuid
          AND c.status = 'RESOLVED'
          AND c.updated_at >= ${from}
          AND c.updated_at <= ${to}
      `,
      prisma.$queryRaw<Array<{ team_id: string | null; first_in: Date; first_out: Date }>>`
        SELECT c.team_id, fi.first_in, fo.first_out
        FROM (
          SELECT m.conversation_id, MIN(m.sent_at) AS first_in
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid
            AND m.direction = 'INBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from}
            AND m.sent_at <= ${to}
          GROUP BY m.conversation_id
        ) fi
        INNER JOIN (
          SELECT m.conversation_id, MIN(m.sent_at) AS first_out
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid
            AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
          GROUP BY m.conversation_id
        ) fo ON fo.conversation_id = fi.conversation_id AND fo.first_out > fi.first_in
        INNER JOIN conversations c ON c.id = fi.conversation_id
      `,
      prisma.team.findMany({
        where: { organizationId: org },
        select: { id: true, businessHours: true },
      }),
      prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
        Prisma.sql`
        SELECT ${Prisma.raw(truncC)} AS bucket, COUNT(*)::int AS n
        FROM conversations c
        WHERE c.organization_id = ${org}::uuid
          AND c.created_at >= ${from}
          AND c.created_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
      ),
      prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
        Prisma.sql`
        SELECT ${Prisma.raw(truncR)} AS bucket, COUNT(*)::int AS n
        FROM conversations c
        WHERE c.organization_id = ${org}::uuid
          AND c.status = 'RESOLVED'
          AND c.updated_at >= ${from}
          AND c.updated_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
      ),
      prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
        Prisma.sql`
        SELECT ${Prisma.raw(truncM)} AS bucket, COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'INBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
      ),
      prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
        Prisma.sql`
        SELECT ${Prisma.raw(truncM)} AS bucket, COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
      ),
      prisma.$queryRaw<
        Array<{
          user_id: string;
          name: string;
          display_name: string | null;
          conversations_touched: number;
          outbound_messages: number;
        }>
      >`
        SELECT
          u.id AS user_id,
          u.name AS name,
          u.display_name AS display_name,
          COALESCE(s.conv_count, 0)::int AS conversations_touched,
          COALESCE(s.msg_count, 0)::int AS outbound_messages
        FROM users u
        LEFT JOIN (
          SELECT
            m.actor_user_id AS uid,
            COUNT(DISTINCT m.conversation_id)::int AS conv_count,
            COUNT(*)::int AS msg_count
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid
            AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from}
            AND m.sent_at <= ${to}
            AND m.actor_user_id IS NOT NULL
          GROUP BY m.actor_user_id
        ) s ON s.uid = u.id
        WHERE u.organization_id = ${org}::uuid
        ORDER BY outbound_messages DESC, u.name ASC
      `,
      prisma.$queryRaw<Array<{ team_id: string; name: string; n: number }>>`
        SELECT t.id AS team_id, t.name AS name, COUNT(*)::int AS n
        FROM conversations c
        INNER JOIN teams t ON t.id = c.team_id
        WHERE c.organization_id = ${org}::uuid
          AND c.team_id IS NOT NULL
          AND c.created_at >= ${from}
          AND c.created_at <= ${to}
        GROUP BY t.id, t.name
        ORDER BY n DESC, t.name ASC
      `,
      prisma.$queryRaw<
        Array<{ lead_id: string; name: string; color: string; resolved: number; value_sum: number }>
      >`
        SELECT
          lt.id AS lead_id,
          lt.name AS name,
          lt.color AS color,
          COUNT(*)::int AS resolved,
          COALESCE(SUM(c.closure_value), 0)::float AS value_sum
        FROM conversations c
        INNER JOIN lead_types lt ON lt.id = c.lead_type_id
        WHERE c.organization_id = ${org}::uuid
          AND c.status = 'RESOLVED'
          AND c.updated_at >= ${from}
          AND c.updated_at <= ${to}
          AND c.lead_type_id IS NOT NULL
        GROUP BY lt.id, lt.name, lt.color
        ORDER BY resolved DESC, value_sum DESC
      `,
      prisma.$queryRaw<Array<{ dow: number; hr: number; n: number }>>`
        SELECT
          EXTRACT(DOW FROM m.sent_at AT TIME ZONE 'UTC')::int AS dow,
          EXTRACT(HOUR FROM m.sent_at AT TIME ZONE 'UTC')::int AS hr,
          COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'INBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
      prisma.$queryRaw<Array<{ tag_id: string; name: string; color: string; n: number }>>`
        SELECT
          tg.id AS tag_id,
          tg.name AS name,
          tg.color AS color,
          COUNT(DISTINCT c.id)::int AS n
        FROM conversations c
        INNER JOIN contacts ct ON ct.id = c.contact_id
        INNER JOIN contact_tags ctg ON ctg.contact_id = ct.id
        INNER JOIN tags tg ON tg.id = ctg.tag_id AND tg.organization_id = ${org}::uuid
        WHERE c.organization_id = ${org}::uuid
          AND c.created_at >= ${from}
          AND c.created_at <= ${to}
        GROUP BY tg.id, tg.name, tg.color
        ORDER BY n DESC
        LIMIT 12
      `,
      prisma.$queryRaw<Array<{ responses: number; avg_score: number | null }>>`
        SELECT
          COUNT(*)::int AS responses,
          AVG(csat_score)::float AS avg_score
        FROM conversations c
        WHERE c.organization_id = ${org}::uuid
          AND c.csat_score IS NOT NULL
          AND c.csat_recorded_at >= ${from}
          AND c.csat_recorded_at <= ${to}
      `,
      prisma.$queryRaw<Array<{ score: number; n: number }>>`
        SELECT c.csat_score AS score, COUNT(*)::int AS n
        FROM conversations c
        WHERE c.organization_id = ${org}::uuid
          AND c.csat_score IS NOT NULL
          AND c.csat_recorded_at >= ${from}
          AND c.csat_recorded_at <= ${to}
        GROUP BY c.csat_score
        ORDER BY c.csat_score ASC
      `,
      prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
        Prisma.sql`
        SELECT ${Prisma.raw(truncM)} AS bucket, COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id IS NULL
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
      ),
      prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
        Prisma.sql`
        SELECT ${Prisma.raw(truncM)} AS bucket, COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id IS NOT NULL
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
      ),
      prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id IS NULL
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
      `,
      prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id IS NOT NULL
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
      `,
      prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(DISTINCT m.conversation_id)::int AS n
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id IS NULL
          AND m.sent_at >= ${from}
          AND m.sent_at <= ${to}
      `,
      prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM timeline_events te
        WHERE te.organization_id = ${org}::uuid
          AND te.event_type = 'conversation.handoff'
          AND te.occurred_at >= ${from}
          AND te.occurred_at <= ${to}
      `,
      prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM timeline_events te
        WHERE te.organization_id = ${org}::uuid
          AND te.event_type = 'conversation.handoff'
          AND te.occurred_at >= ${from}
          AND te.occurred_at <= ${to}
          AND NULLIF(TRIM(te.payload->>'newAssigneeId'), '') IS NOT NULL
      `,
      prisma.conversation.count({
        where: {
          organizationId: org,
          status: "PENDING",
          assignedToId: null,
        },
      }),
    ]);

    const closureAgg = await prisma.conversation.aggregate({
      where: {
        organizationId: org,
        status: "RESOLVED",
        updatedAt: { gte: from, lte: to },
        closureValue: { not: null },
      },
      _sum: { closureValue: true },
      _count: { _all: true },
    });

    const bucketKey = (d: Date) => d.toISOString();

    type TsRow = {
      bucket: string;
      conversationsCreated: number;
      conversationsResolved: number;
      messagesInbound: number;
      messagesOutbound: number;
      messagesOutboundBot: number;
      messagesOutboundHuman: number;
    };

    const merge = new Map<string, TsRow>();

    const touch = (row: { bucket: Date; n: number }, field: keyof Omit<TsRow, "bucket">) => {
      const k = bucketKey(row.bucket);
      const cur: TsRow = merge.get(k) ?? {
        bucket: k,
        conversationsCreated: 0,
        conversationsResolved: 0,
        messagesInbound: 0,
        messagesOutbound: 0,
        messagesOutboundBot: 0,
        messagesOutboundHuman: 0,
      };
      cur[field] = row.n;
      merge.set(k, cur);
    };

    for (const r of createdRows) touch(r, "conversationsCreated");
    for (const r of resolvedRows) touch(r, "conversationsResolved");
    for (const r of inboundRows) touch(r, "messagesInbound");
    for (const r of outboundRows) touch(r, "messagesOutbound");
    for (const r of outboundBotBucketRows) touch(r, "messagesOutboundBot");
    for (const r of outboundHumanActorBucketRows) touch(r, "messagesOutboundHuman");

    const timeSeries = Array.from(merge.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

    const scheduleByTeamId = new Map<string, ParsedBusinessSchedule>();
    for (const row of teamsForBusinessHours) {
      const s = parseTeamBusinessHours(row.businessHours);
      if (s) scheduleByTeamId.set(row.id, s);
    }

    let firstResponseWallSumMin = 0;
    let firstResponseWallN = 0;
    let firstResponseBizSumMin = 0;
    let firstResponseBizN = 0;
    for (const p of firstResponsePairs) {
      const inAt = p.first_in instanceof Date ? p.first_in : new Date(p.first_in);
      const outAt = p.first_out instanceof Date ? p.first_out : new Date(p.first_out);
      const wallMin = (outAt.getTime() - inAt.getTime()) / 60000;
      if (wallMin > 0) {
        firstResponseWallSumMin += wallMin;
        firstResponseWallN += 1;
      }
      if (p.team_id) {
        const sch = scheduleByTeamId.get(p.team_id);
        if (sch) {
          firstResponseBizSumMin += businessMinutesBetween(inAt, outAt, sch);
          firstResponseBizN += 1;
        }
      }
    }
    const avgFirstResponseMinutes =
      firstResponseWallN > 0 ? round2(firstResponseWallSumMin / firstResponseWallN) : null;
    const avgFirstResponseBusinessMinutes =
      firstResponseBizN > 0 ? round2(firstResponseBizSumMin / firstResponseBizN) : null;

    const csatResponses = csatAggRows[0]?.responses ?? 0;
    const csatAverage =
      csatAggRows[0]?.avg_score != null && Number.isFinite(csatAggRows[0].avg_score)
        ? round2(csatAggRows[0].avg_score)
        : null;
    const distMap = new Map(csatDistRows.map((r) => [r.score, r.n]));
    const csatByScore = [1, 2, 3, 4, 5].map((score) => ({
      score,
      count: distMap.get(score) ?? 0,
    }));
    const csatResponseRatePct =
      resolvedInRange > 0 ? round2((csatResponses / resolvedInRange) * 100) : null;

    const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    let heatMax = 0;
    for (const h of heatmapRows) {
      if (h.dow >= 0 && h.dow <= 6 && h.hr >= 0 && h.hr <= 23) {
        heatmap[h.dow]![h.hr] = h.n;
        heatMax = Math.max(heatMax, h.n);
      }
    }

    const settingsBot = await prisma.settings.findUnique({
      where: { organizationId: org },
      include: { agentBot: true },
    });
    const configuredBot = await resolveAgentBotFromOrgSettingsRow(org, settingsBot);

    const messagesOutboundBot = botOutboundTotalRows[0]?.n ?? 0;
    const messagesOutboundHuman = humanOutboundTotalRows[0]?.n ?? 0;
    const conversationsWithBotReplies = conversationsWithBotOutboundRows[0]?.n ?? 0;
    const handoffEvents = handoffEventsRows[0]?.n ?? 0;
    const handoffsToHuman = handoffsToHumanRows[0]?.n ?? 0;

    const botTelemetryDetected =
      messagesOutboundBot > 0 ||
      conversationsWithBotReplies > 0 ||
      handoffEvents > 0 ||
      pendingBotQueueCount > 0;

    const botTelemetryEnabled = configuredBot != null || botTelemetryDetected;

    return {
      meta: {
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
        sla: {
          teamsWithBusinessHours: scheduleByTeamId.size,
          firstResponsePairs: firstResponseWallN,
          firstResponsePairsInBusinessHours: firstResponseBizN,
        },
        agentBot: {
          enabled: botTelemetryEnabled,
          botId: configuredBot?.agentBotId ?? null,
          name: configuredBot?.agentBot.name ?? (botTelemetryEnabled ? "Bot nativo" : null),
        },
      },
      summary: {
        openConversations: openCount,
        pendingConversations: pendingCount,
        conversationsCreated: createdInRange,
        conversationsResolved: resolvedInRange,
        messagesInbound: inboundMsg,
        messagesOutbound: outboundMsg,
        avgFirstResponseMinutes,
        avgFirstResponseBusinessMinutes,
        avgResolutionMinutes: resolutionAvg[0]?.minutes != null ? round2(resolutionAvg[0].minutes) : null,
        closuresWithValue: closureAgg._count._all,
        closureValueSum: closureAgg._sum.closureValue ?? 0,
        csatResponses,
        csatAverage,
        csatResponseRatePct,
        messagesOutboundBot,
        messagesOutboundHuman,
        conversationsWithBotReplies,
        handoffEvents,
        handoffsToHuman,
        pendingBotQueue: pendingBotQueueCount,
      },
      csatByScore,
      timeSeries,
      agents: agentRows.map((r) => ({
        userId: r.user_id,
        name: r.display_name?.trim() || r.name,
        conversationsTouched: r.conversations_touched,
        outboundMessages: r.outbound_messages,
      })),
      teams: teamRows.map((r) => ({
        teamId: r.team_id,
        name: r.name,
        conversationsCreated: r.n,
      })),
      leadTypes: leadTypeRows.map((r) => ({
        leadTypeId: r.lead_id,
        name: r.name,
        color: r.color,
        resolvedCount: r.resolved,
        closureValueSum: r.value_sum,
      })),
      heatmap: { cells: heatmap, max: heatMax },
      tags: tagRows.map((r) => ({
        tagId: r.tag_id,
        name: r.name,
        color: r.color,
        conversationsCount: r.n,
      })),
    };
  });

  /** Análise agregada de IA para saúde da fila. */
  app.post("/ai-health", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const aiEnabledRow = await prisma.settings.findUnique({
      where: { organizationId },
      select: { assistantAiEnabled: true },
    });
    if (aiEnabledRow?.assistantAiEnabled === false) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "AI features disabled",
        statusCode: 403,
        code: "ai_disabled",
      });
    }

    const creds = await getAssistOpenAiCredentialsForOrganization(organizationId);
    if (!creds) {
      return reply.status(503).send({
        error: "Service Unavailable",
        message: "OpenAI API key not configured",
        statusCode: 503,
      });
    }

    const conversations = await prisma.conversation.findMany({
      where: { organizationId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      include: {
        contact: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { direction: true, body: true, isPrivate: true },
        },
      },
    });

    if (conversations.length === 0) {
      return {
        overallHealth: "neutral",
        summary: "Não há conversas abertas para analisar.",
        topIssues: [],
        recommendations: [],
      };
    }

    const lang = (request.headers["accept-language"]?.split(",")[0]?.split("-")[0] || "pt") as string;
    const insights = await Promise.all(
      conversations.map(async (c) => {
        const transcript = buildPublicConversationTranscript(c.messages);
        return analyzeConversationForInsights(
          {
            contactName: c.contact.name ?? "",
            transcript,
            language: lang,
          },
          creds,
        );
      }),
    );

    const report = await analyzeAggregateHealth(insights, creds, lang);

    void recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "ai.aggregate_health",
      resourceType: "REPORT",
      ip: clientIp(request),
      metadata: { conversationCount: conversations.length },
    });

    return report;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
