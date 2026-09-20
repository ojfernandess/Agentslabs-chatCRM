/**
 * Métricas individuais de desempenho por agente (Relatórios → Desempenho por Agente).
 *
 * Definições centralizadas — reutilizar estas fórmulas em qualquer tela relacionada.
 *
 * Atendimentos recebidos:
 *   DISTINCT conversas com interação atribuível ao agente no período:
 *   - repasse (handoff) com newAssigneeId = agente
 *   - registo de encerramento com resolved_by_id ou assigned_to_id = agente
 *   - mensagem humana de saída do agente em conversa com assigned_to_id = agente
 *
 * Atendimentos concluídos:
 *   conversation_closure_records.resolved_by_id = agente AND resolved_at no período
 *
 * Taxa de resolução:
 *   (concluídos / recebidos) × 100 — null quando recebidos = 0
 *
 * Tempo médio 1ª resposta:
 *   AVG(primeira mensagem OUTBOUND humana do agente − primeira INBOUND da conversa)
 *
 * Tempo médio de resposta:
 *   AVG(resposta humana do agente − mensagem INBOUND precedida por OUTBOUND ou início)
 *
 * Tempo médio de atendimento:
 *   AVG(resolved_at − primeira mensagem humana do agente na conversa) nos encerramentos do agente
 *
 * Tempo médio de resolução:
 *   AVG(resolved_at − conversations.created_at) nos encerramentos do agente
 *
 * SLA (quando existir sla_policies na organização):
 *   Compara minutos de parede da 1ª resposta humana do agente vs firstResponseTimeMinutes da política
 *
 * Reaberturas:
 *   closure_records com resolved_by_id = agente AND reopened_at no período
 *
 * Transferências:
 *   timeline_events conversation.handoff com actor_user_id = agente no período
 *
 * Tempo em atendimento (total no período):
 *   SUM(resolved_at − primeira mensagem humana do agente) nos encerramentos do agente
 *
 * Tempo online:
 *   Soma dos intervalos de presença (user_presence_sessions) no período, fundindo sessões
 *   sobrepostas (multi-abas). Fim de sessão = disconnected_at ou last_seen_at + timeout de presença.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { PRESENCE_TIMEOUT_MS } from "./presenceConfig.js";
import { resolveEffectiveAvailabilityForUser } from "./presenceService.js";
import { availabilityToClient } from "./userAvailability.js";

export type AgentPerformanceGranularity = "day" | "week" | "month";

export type AgentPerformanceDetailFilter = {
  organizationId: string;
  userId: string;
  from: Date;
  to: Date;
  granularity: AgentPerformanceGranularity;
};

export type AgentPerformanceChannelRow = {
  channelType: string;
  received: number;
  completed: number;
  avgFirstResponseSec: number | null;
  avgResponseSec: number | null;
  resolutionRatePct: number | null;
  csatAverage: number | null;
  csatResponses: number;
};

export type AgentPerformanceTimeSeriesRow = {
  bucket: string;
  received: number;
  completed: number;
};

export type AgentPerformanceStatusRow = {
  status: string;
  count: number;
};

export type AgentPerformanceDetailPayload = {
  meta: {
    from: string;
    to: string;
    granularity: AgentPerformanceGranularity;
    csatEnabled: boolean;
    slaConfigured: boolean;
    presenceDataAvailable: boolean;
  };
  agent: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    teamNames: string[];
    /** Intent escolhido pelo atendente (persistido). */
    availabilityStatus: "online" | "away" | "offline" | null;
    presenceConnected: boolean;
    /** Estado visual actual (intent + presença heartbeat). */
    effectiveAvailabilityStatus: "online" | "away" | "offline" | null;
  };
  overview: {
    received: number;
    completed: number;
    inProgress: number;
    pending: number;
    resolutionRatePct: number | null;
  };
  times: {
    avgFirstResponseSec: number | null;
    avgResponseSec: number | null;
    avgHandleSec: number | null;
    avgResolutionSec: number | null;
    sampleFirstResponse: number;
    sampleResponse: number;
    sampleHandle: number;
    sampleResolution: number;
  };
  sla: {
    configured: boolean;
    withinPct: number | null;
    violated: number | null;
    evaluated: number;
  };
  csat: {
    enabled: boolean;
    average: number | null;
    responses: number;
  };
  quality: {
    reopenings: number;
    reopenRatePct: number | null;
    transfers: number;
    transferRatePct: number | null;
  };
  productivity: {
    messagesSent: number;
    uniqueClients: number;
    onlineTimeSec: number | null;
    handleTimeSec: number | null;
  };
  byChannel: AgentPerformanceChannelRow[];
  timeSeries: AgentPerformanceTimeSeriesRow[];
  statusDistribution: AgentPerformanceStatusRow[];
};

function truncExpr(tableAlias: string, column: string, g: AgentPerformanceGranularity): string {
  const u = g === "month" ? "month" : g === "week" ? "week" : "day";
  return `date_trunc('${u}', ${tableAlias}.${column})`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round2((numerator / denominator) * 100);
}

function bucketKey(d: Date): string {
  return d.toISOString();
}

type TimeInterval = { start: Date; end: Date };

function sessionEffectiveEnd(
  session: { lastSeenAt: Date; disconnectedAt: Date | null },
  now: Date,
): Date {
  if (session.disconnectedAt) return session.disconnectedAt;
  const timeoutEnd = new Date(session.lastSeenAt.getTime() + PRESENCE_TIMEOUT_MS);
  return timeoutEnd <= now ? timeoutEnd : now;
}

function clipInterval(start: Date, end: Date, from: Date, to: Date): TimeInterval | null {
  const clippedStart = start < from ? from : start;
  const clippedEnd = end > to ? to : end;
  if (clippedEnd <= clippedStart) return null;
  return { start: clippedStart, end: clippedEnd };
}

export function mergePresenceIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function sumIntervalSeconds(intervals: TimeInterval[]): number {
  return intervals.reduce((acc, iv) => acc + (iv.end.getTime() - iv.start.getTime()) / 1000, 0);
}

/** Tempo online real a partir de sessões de presença (heartbeat) no tenant. */
export async function computeAgentOnlineTimeSec(params: {
  userId: string;
  organizationId: string;
  from: Date;
  to: Date;
  now?: Date;
}): Promise<{ onlineTimeSec: number | null; presenceDataAvailable: boolean }> {
  const now = params.now ?? new Date();
  const reportTo = params.to > now ? now : params.to;

  const sessions = await prisma.userPresenceSession.findMany({
    where: {
      userId: params.userId,
      organizationId: params.organizationId,
      createdAt: { lte: params.to },
      OR: [{ disconnectedAt: null }, { disconnectedAt: { gte: params.from } }],
    },
    select: {
      createdAt: true,
      lastSeenAt: true,
      disconnectedAt: true,
    },
  });

  const intervals: TimeInterval[] = [];
  for (const session of sessions) {
    const end = sessionEffectiveEnd(session, now);
    const clipped = clipInterval(session.createdAt, end, params.from, reportTo);
    if (clipped) intervals.push(clipped);
  }

  if (intervals.length === 0) {
    return { onlineTimeSec: null, presenceDataAvailable: false };
  }

  const merged = mergePresenceIntervals(intervals);
  return {
    onlineTimeSec: Math.max(0, Math.round(sumIntervalSeconds(merged))),
    presenceDataAvailable: true,
  };
}

export async function buildAgentPerformanceDetail(
  filter: AgentPerformanceDetailFilter,
): Promise<AgentPerformanceDetailPayload | null> {
  const { organizationId, userId, from, to, granularity } = filter;
  const org = organizationId;
  const agentId = userId;

  const user = await prisma.user.findFirst({
    where: { id: agentId, organizationId: org },
    select: {
      id: true,
      name: true,
      displayName: true,
      avatarUrl: true,
      availabilityStatus: true,
      teamMemberships: { select: { team: { select: { name: true } } } },
    },
  });
  if (!user) return null;

  const [settingsRow, slaPolicyCount] = await Promise.all([
    prisma.settings.findUnique({
      where: { organizationId: org },
      select: { csatEnabled: true },
    }),
    prisma.slaPolicy.count({ where: { organizationId: org } }),
  ]);

  const csatEnabled = settingsRow?.csatEnabled === true;
  const slaConfigured = slaPolicyCount > 0;

  const truncHandoff = truncExpr("te", "occurred_at", granularity);
  const truncResolved = truncExpr("cr", "resolved_at", granularity);

  const [
    overviewRow,
    inProgress,
    pending,
    timesFirstRow,
    timesResponseRow,
    timesHandleRow,
    timesResolutionRow,
    slaRow,
    csatRow,
    reopenRow,
    transferRow,
    messagesRow,
    clientsRow,
    channelRows,
    handoffSeriesRows,
    completedSeriesRows,
    statusRows,
    onlineTimeResult,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{ received: number; completed: number }>
    >`
      WITH agent_conversations AS (
        SELECT DISTINCT conv_id FROM (
          SELECT (te.payload->>'conversationId')::uuid AS conv_id
          FROM timeline_events te
          WHERE te.organization_id = ${org}::uuid
            AND te.event_type = 'conversation.handoff'
            AND te.payload->>'newAssigneeId' = ${agentId}
            AND te.occurred_at >= ${from}
            AND te.occurred_at <= ${to}
            AND NULLIF(TRIM(te.payload->>'conversationId'), '') IS NOT NULL
          UNION
          SELECT cr.conversation_id AS conv_id
          FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND (cr.resolved_by_id = ${agentId}::uuid OR cr.assigned_to_id = ${agentId}::uuid)
            AND cr.resolved_at >= ${from}
            AND cr.resolved_at <= ${to}
          UNION
          SELECT m.conversation_id AS conv_id
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid
            AND c.assigned_to_id = ${agentId}::uuid
            AND m.actor_user_id = ${agentId}::uuid
            AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from}
            AND m.sent_at <= ${to}
        ) u
        WHERE conv_id IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM agent_conversations) AS received,
        (
          SELECT COUNT(*)::int
          FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND cr.resolved_by_id = ${agentId}::uuid
            AND cr.resolved_at >= ${from}
            AND cr.resolved_at <= ${to}
        ) AS completed
    `,
    prisma.conversation.count({
      where: {
        organizationId: org,
        assignedToId: agentId,
        status: "OPEN",
        deletedAt: null,
      },
    }),
    prisma.conversation.count({
      where: {
        organizationId: org,
        assignedToId: agentId,
        status: "PENDING",
        deletedAt: null,
      },
    }),
    prisma.$queryRaw<Array<{ avg_sec: number | null; sample_n: number }>>`
      WITH agent_conversations AS (
        SELECT DISTINCT conv_id FROM (
          SELECT (te.payload->>'conversationId')::uuid AS conv_id
          FROM timeline_events te
          WHERE te.organization_id = ${org}::uuid
            AND te.event_type = 'conversation.handoff'
            AND te.payload->>'newAssigneeId' = ${agentId}
            AND te.occurred_at >= ${from} AND te.occurred_at <= ${to}
            AND NULLIF(TRIM(te.payload->>'conversationId'), '') IS NOT NULL
          UNION
          SELECT cr.conversation_id FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND (cr.resolved_by_id = ${agentId}::uuid OR cr.assigned_to_id = ${agentId}::uuid)
            AND cr.resolved_at >= ${from} AND cr.resolved_at <= ${to}
          UNION
          SELECT m.conversation_id FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid AND c.assigned_to_id = ${agentId}::uuid
            AND m.actor_user_id = ${agentId}::uuid AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from} AND m.sent_at <= ${to}
        ) u WHERE conv_id IS NOT NULL
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (fo.first_out - fi.first_in)))::float AS avg_sec,
        COUNT(*)::int AS sample_n
      FROM agent_conversations ac
      INNER JOIN (
        SELECT m.conversation_id, MIN(m.sent_at) AS first_in
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = ${org}::uuid
          AND m.direction = 'INBOUND' AND COALESCE(m.is_private, false) = false
        GROUP BY m.conversation_id
      ) fi ON fi.conversation_id = ac.conv_id
      INNER JOIN (
        SELECT m.conversation_id, MIN(m.sent_at) AS first_out
        FROM messages m
        WHERE m.direction = 'OUTBOUND' AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id = ${agentId}::uuid
        GROUP BY m.conversation_id
      ) fo ON fo.conversation_id = ac.conv_id AND fo.first_out > fi.first_in
    `,
    prisma.$queryRaw<Array<{ avg_sec: number | null; sample_n: number }>>`
      SELECT
        AVG(EXTRACT(EPOCH FROM (resp.response_at - m_in.sent_at)))::float AS avg_sec,
        COUNT(*)::int AS sample_n
      FROM messages m_in
      INNER JOIN conversations c ON c.id = m_in.conversation_id
      INNER JOIN LATERAL (
        SELECT mp.direction
        FROM messages mp
        WHERE mp.conversation_id = m_in.conversation_id
          AND mp.sent_at < m_in.sent_at
          AND COALESCE(mp.is_private, false) = false
        ORDER BY mp.sent_at DESC
        LIMIT 1
      ) prev ON true
      INNER JOIN LATERAL (
        SELECT m2.sent_at AS response_at
        FROM messages m2
        WHERE m2.conversation_id = m_in.conversation_id
          AND m2.direction = 'OUTBOUND'
          AND COALESCE(m2.is_private, false) = false
          AND m2.actor_user_id = ${agentId}::uuid
          AND m2.sent_at > m_in.sent_at
        ORDER BY m2.sent_at ASC
        LIMIT 1
      ) resp ON true
      WHERE c.organization_id = ${org}::uuid
        AND m_in.direction = 'INBOUND'
        AND COALESCE(m_in.is_private, false) = false
        AND m_in.sent_at >= ${from}
        AND m_in.sent_at <= ${to}
        AND (prev.direction IS NULL OR prev.direction <> 'INBOUND')
    `,
    prisma.$queryRaw<Array<{ avg_sec: number | null; total_sec: number | null; sample_n: number }>>`
      SELECT
        AVG(EXTRACT(EPOCH FROM (cr.resolved_at - fam.first_agent_msg)))::float AS avg_sec,
        SUM(EXTRACT(EPOCH FROM (cr.resolved_at - fam.first_agent_msg)))::float AS total_sec,
        COUNT(*)::int AS sample_n
      FROM conversation_closure_records cr
      INNER JOIN (
        SELECT m.conversation_id, MIN(m.sent_at) AS first_agent_msg
        FROM messages m
        WHERE m.actor_user_id = ${agentId}::uuid
          AND m.direction = 'OUTBOUND'
          AND COALESCE(m.is_private, false) = false
        GROUP BY m.conversation_id
      ) fam ON fam.conversation_id = cr.conversation_id
      WHERE cr.organization_id = ${org}::uuid
        AND cr.resolved_by_id = ${agentId}::uuid
        AND cr.resolved_at >= ${from}
        AND cr.resolved_at <= ${to}
        AND cr.resolved_at > fam.first_agent_msg
    `,
    prisma.$queryRaw<Array<{ avg_sec: number | null; sample_n: number }>>`
      SELECT
        AVG(EXTRACT(EPOCH FROM (cr.resolved_at - c.created_at)))::float AS avg_sec,
        COUNT(*)::int AS sample_n
      FROM conversation_closure_records cr
      INNER JOIN conversations c ON c.id = cr.conversation_id
      WHERE cr.organization_id = ${org}::uuid
        AND cr.resolved_by_id = ${agentId}::uuid
        AND cr.resolved_at >= ${from}
        AND cr.resolved_at <= ${to}
    `,
    slaConfigured
      ? prisma.$queryRaw<Array<{ within_n: number; violated_n: number; evaluated_n: number }>>`
          WITH sla_limit AS (
            SELECT first_response_time_minutes AS limit_min
            FROM sla_policies
            WHERE organization_id = ${org}::uuid
            ORDER BY created_at ASC
            LIMIT 1
          ),
          pairs AS (
            SELECT EXTRACT(EPOCH FROM (fo.first_out - fi.first_in)) / 60.0 AS minutes
            FROM (
              SELECT DISTINCT conv_id FROM (
                SELECT (te.payload->>'conversationId')::uuid AS conv_id
                FROM timeline_events te
                WHERE te.organization_id = ${org}::uuid
                  AND te.event_type = 'conversation.handoff'
                  AND te.payload->>'newAssigneeId' = ${agentId}
                  AND te.occurred_at >= ${from} AND te.occurred_at <= ${to}
                UNION
                SELECT cr.conversation_id FROM conversation_closure_records cr
                WHERE cr.organization_id = ${org}::uuid
                  AND cr.resolved_by_id = ${agentId}::uuid
                  AND cr.resolved_at >= ${from} AND cr.resolved_at <= ${to}
              ) u WHERE conv_id IS NOT NULL
            ) ac
            INNER JOIN (
              SELECT m.conversation_id, MIN(m.sent_at) AS first_in
              FROM messages m
              INNER JOIN conversations c ON c.id = m.conversation_id
              WHERE c.organization_id = ${org}::uuid
                AND m.direction = 'INBOUND' AND COALESCE(m.is_private, false) = false
              GROUP BY m.conversation_id
            ) fi ON fi.conversation_id = ac.conv_id
            INNER JOIN (
              SELECT m.conversation_id, MIN(m.sent_at) AS first_out
              FROM messages m
              WHERE m.direction = 'OUTBOUND' AND COALESCE(m.is_private, false) = false
                AND m.actor_user_id = ${agentId}::uuid
              GROUP BY m.conversation_id
            ) fo ON fo.conversation_id = ac.conv_id AND fo.first_out > fi.first_in
          )
          SELECT
            COUNT(*) FILTER (WHERE p.minutes <= sl.limit_min)::int AS within_n,
            COUNT(*) FILTER (WHERE p.minutes > sl.limit_min)::int AS violated_n,
            COUNT(*)::int AS evaluated_n
          FROM pairs p
          CROSS JOIN sla_limit sl
        `
      : Promise.resolve([{ within_n: 0, violated_n: 0, evaluated_n: 0 }]),
    csatEnabled
      ? prisma.$queryRaw<Array<{ responses: number; avg_score: number | null }>>`
          SELECT COUNT(*)::int AS responses, AVG(cr.csat_score)::float AS avg_score
          FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND cr.resolved_by_id = ${agentId}::uuid
            AND cr.csat_score IS NOT NULL
            AND cr.csat_recorded_at >= ${from}
            AND cr.csat_recorded_at <= ${to}
        `
      : Promise.resolve([{ responses: 0, avg_score: null }]),
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM conversation_closure_records cr
      WHERE cr.organization_id = ${org}::uuid
        AND cr.resolved_by_id = ${agentId}::uuid
        AND cr.reopened_at IS NOT NULL
        AND cr.reopened_at >= ${from}
        AND cr.reopened_at <= ${to}
    `,
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM timeline_events te
      WHERE te.organization_id = ${org}::uuid
        AND te.event_type = 'conversation.handoff'
        AND te.actor_user_id = ${agentId}::uuid
        AND te.occurred_at >= ${from}
        AND te.occurred_at <= ${to}
    `,
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE c.organization_id = ${org}::uuid
        AND m.direction = 'OUTBOUND'
        AND COALESCE(m.is_private, false) = false
        AND m.actor_user_id = ${agentId}::uuid
        AND m.sent_at >= ${from}
        AND m.sent_at <= ${to}
    `,
    prisma.$queryRaw<Array<{ n: number }>>`
      WITH agent_conversations AS (
        SELECT DISTINCT conv_id FROM (
          SELECT (te.payload->>'conversationId')::uuid AS conv_id
          FROM timeline_events te
          WHERE te.organization_id = ${org}::uuid
            AND te.event_type = 'conversation.handoff'
            AND te.payload->>'newAssigneeId' = ${agentId}
            AND te.occurred_at >= ${from} AND te.occurred_at <= ${to}
          UNION
          SELECT cr.conversation_id FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND (cr.resolved_by_id = ${agentId}::uuid OR cr.assigned_to_id = ${agentId}::uuid)
            AND cr.resolved_at >= ${from} AND cr.resolved_at <= ${to}
          UNION
          SELECT m.conversation_id FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid AND c.assigned_to_id = ${agentId}::uuid
            AND m.actor_user_id = ${agentId}::uuid AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from} AND m.sent_at <= ${to}
        ) u WHERE conv_id IS NOT NULL
      )
      SELECT COUNT(DISTINCT c.contact_id)::int AS n
      FROM agent_conversations ac
      INNER JOIN conversations c ON c.id = ac.conv_id
      WHERE c.contact_id IS NOT NULL
    `,
    prisma.$queryRaw<
      Array<{
        channel_type: string;
        received: number;
        completed: number;
        avg_first_sec: number | null;
        avg_response_sec: number | null;
        csat_avg: number | null;
        csat_n: number;
      }>
    >`
      WITH agent_conversations AS (
        SELECT DISTINCT conv_id FROM (
          SELECT (te.payload->>'conversationId')::uuid AS conv_id
          FROM timeline_events te
          WHERE te.organization_id = ${org}::uuid
            AND te.event_type = 'conversation.handoff'
            AND te.payload->>'newAssigneeId' = ${agentId}
            AND te.occurred_at >= ${from} AND te.occurred_at <= ${to}
          UNION
          SELECT cr.conversation_id FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND (cr.resolved_by_id = ${agentId}::uuid OR cr.assigned_to_id = ${agentId}::uuid)
            AND cr.resolved_at >= ${from} AND cr.resolved_at <= ${to}
          UNION
          SELECT m.conversation_id FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid AND c.assigned_to_id = ${agentId}::uuid
            AND m.actor_user_id = ${agentId}::uuid AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from} AND m.sent_at <= ${to}
        ) u WHERE conv_id IS NOT NULL
      )
      SELECT
        i.channel_type::text AS channel_type,
        COUNT(DISTINCT ac.conv_id)::int AS received,
        COUNT(DISTINCT CASE
          WHEN cr.resolved_by_id = ${agentId}::uuid
            AND cr.resolved_at >= ${from} AND cr.resolved_at <= ${to}
          THEN ac.conv_id END)::int AS completed,
        AVG(CASE WHEN fo.first_out IS NOT NULL AND fi.first_in IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fo.first_out - fi.first_in)) END)::float AS avg_first_sec,
        NULL::float AS avg_response_sec,
        AVG(CASE WHEN cr.csat_score IS NOT NULL THEN cr.csat_score END)::float AS csat_avg,
        COUNT(cr.csat_score)::int AS csat_n
      FROM agent_conversations ac
      INNER JOIN conversations c ON c.id = ac.conv_id
      INNER JOIN inboxes i ON i.id = c.inbox_id
      LEFT JOIN conversation_closure_records cr ON cr.conversation_id = ac.conv_id
        AND cr.organization_id = ${org}::uuid
        AND cr.resolved_by_id = ${agentId}::uuid
      LEFT JOIN (
        SELECT m.conversation_id, MIN(m.sent_at) AS first_in
        FROM messages m
        WHERE m.direction = 'INBOUND' AND COALESCE(m.is_private, false) = false
        GROUP BY m.conversation_id
      ) fi ON fi.conversation_id = ac.conv_id
      LEFT JOIN (
        SELECT m.conversation_id, MIN(m.sent_at) AS first_out
        FROM messages m
        WHERE m.direction = 'OUTBOUND' AND COALESCE(m.is_private, false) = false
          AND m.actor_user_id = ${agentId}::uuid
        GROUP BY m.conversation_id
      ) fo ON fo.conversation_id = ac.conv_id AND fo.first_out > fi.first_in
      GROUP BY i.channel_type
      ORDER BY received DESC, i.channel_type ASC
    `,
    prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
      Prisma.sql`
        WITH received_events AS (
          SELECT ${Prisma.raw(truncHandoff)} AS bucket, (te.payload->>'conversationId')::uuid AS conv_id
          FROM timeline_events te
          WHERE te.organization_id = ${org}::uuid
            AND te.event_type = 'conversation.handoff'
            AND te.payload->>'newAssigneeId' = ${agentId}
            AND te.occurred_at >= ${from}
            AND te.occurred_at <= ${to}
            AND NULLIF(TRIM(te.payload->>'conversationId'), '') IS NOT NULL
          UNION ALL
          SELECT ${Prisma.raw(truncResolved)}, cr.conversation_id
          FROM conversation_closure_records cr
          WHERE cr.organization_id = ${org}::uuid
            AND (cr.resolved_by_id = ${agentId}::uuid OR cr.assigned_to_id = ${agentId}::uuid)
            AND cr.resolved_at >= ${from}
            AND cr.resolved_at <= ${to}
          UNION ALL
          SELECT ${Prisma.raw(truncExpr("m", "sent_at", granularity))}, m.conversation_id
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = ${org}::uuid
            AND c.assigned_to_id = ${agentId}::uuid
            AND m.actor_user_id = ${agentId}::uuid
            AND m.direction = 'OUTBOUND'
            AND COALESCE(m.is_private, false) = false
            AND m.sent_at >= ${from}
            AND m.sent_at <= ${to}
        )
        SELECT bucket, COUNT(DISTINCT conv_id)::int AS n
        FROM received_events
        WHERE conv_id IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket ASC`,
    ),
    prisma.$queryRaw<Array<{ bucket: Date; n: number }>>(
      Prisma.sql`
        SELECT ${Prisma.raw(truncResolved)} AS bucket, COUNT(*)::int AS n
        FROM conversation_closure_records cr
        WHERE cr.organization_id = ${org}::uuid
          AND cr.resolved_by_id = ${agentId}::uuid
          AND cr.resolved_at >= ${from}
          AND cr.resolved_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
    ),
    prisma.$queryRaw<Array<{ status_key: string; n: number }>>`
      SELECT 'completed'::text AS status_key, COUNT(*)::int AS n
      FROM conversation_closure_records cr
      WHERE cr.organization_id = ${org}::uuid
        AND cr.resolved_by_id = ${agentId}::uuid
        AND cr.resolved_at >= ${from}
        AND cr.resolved_at <= ${to}
      UNION ALL
      SELECT 'in_progress'::text, COUNT(*)::int
      FROM conversations c
      WHERE c.organization_id = ${org}::uuid
        AND c.assigned_to_id = ${agentId}::uuid
        AND c.status = 'OPEN'
        AND c.deleted_at IS NULL
      UNION ALL
      SELECT 'pending'::text, COUNT(*)::int
      FROM conversations c
      WHERE c.organization_id = ${org}::uuid
        AND c.assigned_to_id = ${agentId}::uuid
        AND c.status = 'PENDING'
        AND c.deleted_at IS NULL
      UNION ALL
      SELECT 'transferred'::text, COUNT(*)::int
      FROM timeline_events te
      WHERE te.organization_id = ${org}::uuid
        AND te.event_type = 'conversation.handoff'
        AND te.actor_user_id = ${agentId}::uuid
        AND te.occurred_at >= ${from}
        AND te.occurred_at <= ${to}
    `,
    computeAgentOnlineTimeSec({
      userId: agentId,
      organizationId: org,
      from,
      to,
    }),
  ]);

  const received = overviewRow[0]?.received ?? 0;
  const completed = overviewRow[0]?.completed ?? 0;
  const reopenings = reopenRow[0]?.n ?? 0;
  const transfers = transferRow[0]?.n ?? 0;

  const slaEvaluated = slaRow[0]?.evaluated_n ?? 0;
  const slaWithin = slaRow[0]?.within_n ?? 0;
  const slaViolated = slaRow[0]?.violated_n ?? 0;

  const tsMerge = new Map<string, AgentPerformanceTimeSeriesRow>();
  for (const r of handoffSeriesRows) {
    const k = bucketKey(r.bucket);
    const cur = tsMerge.get(k) ?? { bucket: k, received: 0, completed: 0 };
    cur.received += r.n;
    tsMerge.set(k, cur);
  }
  for (const r of completedSeriesRows) {
    const k = bucketKey(r.bucket);
    const cur = tsMerge.get(k) ?? { bucket: k, received: 0, completed: 0 };
    cur.completed = r.n;
    tsMerge.set(k, cur);
  }
  const timeSeries = Array.from(tsMerge.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

  const presence = await resolveEffectiveAvailabilityForUser(
    user.id,
    org,
    user.availabilityStatus,
  );

  return {
    meta: {
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      csatEnabled,
      slaConfigured,
      presenceDataAvailable: onlineTimeResult.presenceDataAvailable,
    },
    agent: {
      userId: user.id,
      name: user.displayName?.trim() || user.name,
      avatarUrl: user.avatarUrl,
      teamNames: user.teamMemberships.map((m) => m.team.name),
      availabilityStatus: availabilityToClient(user.availabilityStatus),
      presenceConnected: presence.presenceConnected,
      effectiveAvailabilityStatus: presence.effectiveAvailabilityStatus,
    },
    overview: {
      received,
      completed,
      inProgress,
      pending,
      resolutionRatePct: pct(completed, received),
    },
    times: {
      avgFirstResponseSec: timesFirstRow[0]?.avg_sec ?? null,
      avgResponseSec: timesResponseRow[0]?.avg_sec ?? null,
      avgHandleSec: timesHandleRow[0]?.avg_sec ?? null,
      avgResolutionSec: timesResolutionRow[0]?.avg_sec ?? null,
      sampleFirstResponse: timesFirstRow[0]?.sample_n ?? 0,
      sampleResponse: timesResponseRow[0]?.sample_n ?? 0,
      sampleHandle: timesHandleRow[0]?.sample_n ?? 0,
      sampleResolution: timesResolutionRow[0]?.sample_n ?? 0,
    },
    sla: {
      configured: slaConfigured,
      withinPct: slaConfigured && slaEvaluated > 0 ? pct(slaWithin, slaEvaluated) : null,
      violated: slaConfigured ? slaViolated : null,
      evaluated: slaEvaluated,
    },
    csat: {
      enabled: csatEnabled,
      average: csatRow[0]?.avg_score != null ? round2(csatRow[0].avg_score) : null,
      responses: csatRow[0]?.responses ?? 0,
    },
    quality: {
      reopenings,
      reopenRatePct: pct(reopenings, completed),
      transfers,
      transferRatePct: pct(transfers, received),
    },
    productivity: {
      messagesSent: messagesRow[0]?.n ?? 0,
      uniqueClients: clientsRow[0]?.n ?? 0,
      onlineTimeSec: onlineTimeResult.onlineTimeSec,
      handleTimeSec:
        (timesHandleRow[0]?.sample_n ?? 0) > 0 && timesHandleRow[0]?.total_sec != null
          ? Math.max(0, Math.round(timesHandleRow[0].total_sec))
          : null,
    },
    byChannel: channelRows.map((r) => ({
      channelType: r.channel_type,
      received: r.received,
      completed: r.completed,
      avgFirstResponseSec: r.avg_first_sec,
      avgResponseSec: r.avg_response_sec,
      resolutionRatePct: pct(r.completed, r.received),
      csatAverage: r.csat_n > 0 && r.csat_avg != null ? round2(r.csat_avg) : null,
      csatResponses: r.csat_n,
    })),
    timeSeries,
    statusDistribution: statusRows.map((r) => ({ status: r.status_key, count: r.n })),
  };
}
