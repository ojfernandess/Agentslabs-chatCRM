import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireSuperAdmin } from "../middleware/auth.js";
import type { JwtPayload } from "../middleware/auth.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { broadcastToOrganization } from "../lib/workspaceHub.js";
import type { InboxChannelType, Prisma } from "@prisma/client";
import { appendTimelineEvent } from "../lib/timeline.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";
import { buildCsatWhatsAppBody, newCsatSurveyToken } from "../lib/csatSurvey.js";
import { dispatchAgentBotWebhook } from "../lib/agentBotWebhook.js";
import { clearAutomationConversationContext } from "../lib/automationConversationContextLib.js";
import {
  computeAgentBotTriageActive,
  getAgentBotDispatchContextForInbox,
  listInboxIdsWithAgentBotTriage,
} from "../lib/agentBotTriage.js";
import {
  loadLastReadAtByConversation,
  markConversationReadForUser,
  markConversationUnreadForUser,
  withUnreadFlag,
} from "../lib/teamTransferUnread.js";
import {
  hasContactAvatarCache,
  syncContactProfilePicture,
  syncContactProfilePicturesBatch,
} from "../lib/contactProfilePictureResolve.js";
import { clientIp, recordAuditLog } from "../lib/audit.js";
import {
  closureRecordInclude,
  createConversationClosureRecord,
  markConversationClosureReopened,
} from "../lib/conversationClosureRecords.js";
import {
  computeClosureRollupTotals,
  pickLatestClosureRecord,
  shouldCarryForwardClosureValue,
} from "../lib/closureValueRollup.js";
import {
  applyContactStageForLeadType,
  loadLeadTypePlaybook,
  maybeCreateDealOnConversationClosure,
  maybeCreateReminderOnConversationClosure,
} from "../lib/conversationClosureCommerce.js";
import { fireCrmFlowTriggers } from "../lib/crmFlowHooks.js";
import { dispatchAiAlertWebhook } from "../lib/aiAlertWebhook.js";
import {
  analyzeConversationForInsights,
  buildPublicConversationTranscript,
  getAssistOpenAiCredentialsForOrganization,
  suggestAgentReplyText,
} from "../lib/agentAssistLlm.js";
import { loadActiveVoiceCallsByConversation } from "../lib/activeVoiceCalls.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  since: z.string().optional(),
  teamId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  leadTypeId: z.string().uuid().optional(),
  inboxId: z.string().uuid().optional(),
  mine: z.enum(["1", "true", "0", "false"]).optional(),
  botAttendance: z.enum(["1", "true", "0", "false"]).optional(),
  waitingAttendance: z.enum(["1", "true", "0", "false"]).optional(),
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).default("RESOLVED"),
  assignedToId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  leadTypeId: z.string().uuid().optional(),
  inboxId: z.string().uuid().optional(),
  resolvedFrom: z.string().optional(),
  resolvedTo: z.string().optional(),
});

const myAttendanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(100),
});

const updateSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  closureReason: z.union([z.string().max(4000), z.null()]).optional(),
  leadTypeId: z.union([z.string().uuid(), z.null()]).optional(),
  closureValue: z.number().nonnegative().nullable().optional(),
  resolveReminder: z
    .object({
      note: z.string().min(1).max(2000),
      dueAt: z
        .string()
        .min(1)
        .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Invalid dueAt" }),
    })
    .optional(),
  awaitingHumanHandoff: z.literal(false).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullable().optional(),
});

const CONTACT_TIMELINE_LIMIT = 80;

async function fetchContactTimelineForConversation(organizationId: string, contactId: string) {
  return prisma.timelineEvent.findMany({
    where: { organizationId, subjectType: "CONTACT", subjectId: contactId },
    orderBy: { occurredAt: "desc" },
    take: CONTACT_TIMELINE_LIMIT,
    include: { actorUser: { select: { id: true, name: true, email: true } } },
  });
}

/** Agente tem de ser membro da caixa para ver ou alterar a conversa. */
async function agentIsMemberOfInbox(
  userId: string,
  organizationId: string,
  inboxId: string,
): Promise<boolean> {
  const m = await prisma.inboxMember.findFirst({
    where: { userId, inboxId, inbox: { organizationId } },
  });
  return !!m;
}

/** Sem equipa na conversa = visível para toda a organização. Com equipa = só membros dessa equipa (e admins). */
async function agentCanViewConversation(
  userId: string,
  organizationId: string,
  conv: { teamId: string | null },
): Promise<boolean> {
  if (!conv.teamId) return true;
  const m = await prisma.teamMember.findFirst({
    where: { userId, teamId: conv.teamId, team: { organizationId } },
  });
  return !!m;
}

async function agentCanAccessConversation(
  userId: string,
  organizationId: string,
  conv: { teamId: string | null; inboxId: string },
): Promise<boolean> {
  if (!(await agentIsMemberOfInbox(userId, organizationId, conv.inboxId))) return false;
  return agentCanViewConversation(userId, organizationId, { teamId: conv.teamId });
}

function isTenantAdmin(user: JwtPayload): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

function isMineFlag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

/** Não expor `csatSurveyToken` ao painel; indicar se ainda falta resposta do cliente. */
function stripCsatSurveyToken<C extends { csatSurveyToken?: string | null; csatScore?: number | null; status: string }>(
  row: C,
): Omit<C, "csatSurveyToken"> & { csatSurveyPending: boolean } {
  const { csatSurveyToken, ...rest } = row;
  return {
    ...rest,
    csatSurveyPending:
      row.status === "RESOLVED" && csatSurveyToken != null && row.csatScore == null,
  } as Omit<C, "csatSurveyToken"> & { csatSurveyPending: boolean };
}

async function buildAgentBotTriageMapForInboxes(
  organizationId: string,
  rows: { inboxId: string; inbox?: { channelType?: string } | null }[],
): Promise<Map<string, boolean>> {
  const uniqueInboxIds = [...new Set(rows.map((r) => r.inboxId).filter(Boolean))];
  const triageMap = new Map<string, boolean>();
  for (const inboxId of uniqueInboxIds) {
    const row = rows.find((r) => r.inboxId === inboxId);
    const inboxChannelType =
      row?.inbox?.channelType && typeof row.inbox.channelType === "string"
        ? (row.inbox.channelType as InboxChannelType)
        : ("WHATSAPP" as InboxChannelType);
    const ctx = await getAgentBotDispatchContextForInbox(organizationId, inboxId);
    triageMap.set(
      inboxId,
      computeAgentBotTriageActive(ctx, inboxChannelType),
    );
  }
  return triageMap;
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = querySchema.parse(request.query);
    const where: Prisma.ConversationWhereInput = { organizationId };
    const botAttendance = isMineFlag(query.botAttendance);
    const waitingAttendance = isMineFlag(query.waitingAttendance);
    const mineRequested = isMineFlag(query.mine);

    if (!botAttendance && !(waitingAttendance && !mineRequested) && query.status) {
      where.status = query.status;
    }

    if (query.since) {
      const d = new Date(query.since);
      if (!Number.isNaN(d.getTime())) {
        where.updatedAt = { gt: d };
      }
    }

    if (query.leadTypeId) {
      where.AND = [
        {
          OR: [
            { leadTypeId: query.leadTypeId },
            { contact: { pipelineStage: { leadTypeId: query.leadTypeId } } },
          ],
        },
      ];
    }

    if (query.inboxId) {
      const inbox = await prisma.inbox.findFirst({ where: { id: query.inboxId, organizationId } });
      if (!inbox) {
        return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
      }
      if (request.user.role === "AGENT") {
        const ok = await agentIsMemberOfInbox(request.user.id, organizationId, query.inboxId);
        if (!ok) {
          return reply.status(403).send({
            error: "Forbidden",
            message: "You are not a member of this inbox",
            statusCode: 403,
          });
        }
      }
      where.inboxId = query.inboxId;
    } else if (request.user.role === "AGENT") {
      const myInboxes = await prisma.inboxMember.findMany({
        where: { userId: request.user.id, inbox: { organizationId } },
        select: { inboxId: true },
      });
      const ids = myInboxes.map((x) => x.inboxId);
      where.inboxId = ids.length > 0 ? { in: ids } : { in: [] };
    }

    const mine = botAttendance ? false : mineRequested;
    const effectiveAssigneeId = mine ? request.user.id : query.assignedToId;

    /** Fila «aguardando atendimento» só quando não pedido `mine` (Meus atendimentos mantém comportamento próprio). */
    if (waitingAttendance && !mineRequested) {
      const orgSettings = await prisma.settings.findUnique({
        where: { organizationId },
        select: { conversationsAttendanceTabEnabled: true },
      });
      if (!orgSettings?.conversationsAttendanceTabEnabled) {
        return { data: [], total: 0, page: query.page, pageSize: query.pageSize };
      }
      where.status = "OPEN";
      where.assignedToId = null;
    }

    if (botAttendance) {
      let candidateInboxIds: string[] | undefined;
      const inboxFilter = where.inboxId;
      if (inboxFilter && typeof inboxFilter === "object" && "in" in inboxFilter && Array.isArray(inboxFilter.in)) {
        candidateInboxIds = inboxFilter.in as string[];
      } else if (typeof inboxFilter === "string") {
        candidateInboxIds = [inboxFilter];
      }
      const triageInboxIds = await listInboxIdsWithAgentBotTriage(organizationId, candidateInboxIds);
      if (triageInboxIds.length === 0) {
        return { data: [], total: 0, page: query.page, pageSize: query.pageSize };
      }
      where.inboxId = { in: triageInboxIds };
      where.status = { in: ["OPEN", "PENDING"] };
      where.assignedToId = null;
      where.awaitingHumanHandoff = false;
    }

    if (request.user.role === "AGENT") {
      if (effectiveAssigneeId) {
        if (effectiveAssigneeId !== request.user.id) {
          return reply.status(403).send({
            error: "Forbidden",
            message: "Agents may only list their own assigned conversations",
            statusCode: 403,
          });
        }
        where.assignedToId = request.user.id;
        if (query.teamId) {
          const member = await prisma.teamMember.findFirst({
            where: {
              userId: request.user.id,
              teamId: query.teamId,
              team: { organizationId },
            },
          });
          if (!member) {
            return reply.status(403).send({
              error: "Forbidden",
              message: "You are not a member of this team",
              statusCode: 403,
            });
          }
          where.teamId = query.teamId;
        }
      } else if (query.teamId) {
        const member = await prisma.teamMember.findFirst({
          where: {
            userId: request.user.id,
            teamId: query.teamId,
            team: { organizationId },
          },
        });
        if (!member) {
          return reply.status(403).send({
            error: "Forbidden",
            message: "You are not a member of this team",
            statusCode: 403,
          });
        }
        where.teamId = query.teamId;
      } else {
        const myTeams = await prisma.teamMember.findMany({
          where: { userId: request.user.id, team: { organizationId } },
          select: { teamId: true },
        });
        const teamIds = myTeams.map((t) => t.teamId);
        where.OR = [
          { teamId: null },
          ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
        ];
      }
    } else {
      if (effectiveAssigneeId) {
        where.assignedToId = effectiveAssigneeId;
      }
      if (query.teamId) {
        where.teamId = query.teamId;
      }
    }

    const contactListSelect = {
      id: true,
      name: true,
      phone: true,
      profilePictureUrl: true,
      createdAt: true,
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      pipelineStage: {
        select: { id: true, name: true, color: true, leadTypeId: true },
      },
      tags: {
        select: {
          tag: { select: { id: true, name: true, color: true } },
        },
      },
    } as const;

    const [data, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: contactListSelect },
          assignedTo: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
          leadType: { select: { id: true, name: true, color: true, valueRollup: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);

    const triageByInbox = await buildAgentBotTriageMapForInboxes(organizationId, data);
    const lastReadByConversation = await loadLastReadAtByConversation(
      prisma,
      request.user.id,
      data.map((row) => row.id),
    );
    const withFlags = withUnreadFlag(
      data.map((row) => ({
        ...row,
        lastMessage: row.messages[0] ?? null,
      })),
      lastReadByConversation,
    );

    const uniqueContactIds = [...new Set(withFlags.map((row) => row.contact.id))];
    const avatarByContact = new Map<string, boolean>();
    await Promise.all(
      uniqueContactIds.map(async (contactId) => {
        const has = await hasContactAvatarCache(organizationId, contactId);
        avatarByContact.set(contactId, has);
      }),
    );
    void syncContactProfilePicturesBatch({ organizationId, contactIds: uniqueContactIds }).catch(() => {});

    const activeVoiceByConversation = await loadActiveVoiceCallsByConversation(
      organizationId,
      withFlags.map((row) => row.id),
    );

    return {
      data: withFlags.map((row) => {
        const { lastMessage: _lastMessage, ...rest } = row;
        return {
          ...stripCsatSurveyToken(rest),
          agentBotTriageActive: triageByInbox.get(row.inboxId) ?? false,
          isUnread: row.isUnread,
          activeVoiceCall: activeVoiceByConversation.get(row.id) ?? null,
          contact: {
            ...rest.contact,
            hasAvatar: avatarByContact.get(rest.contact.id) ?? false,
            thumbnail: avatarByContact.get(rest.contact.id)
              ? `/api/v1/contacts/${rest.contact.id}/profile-picture`
              : null,
          },
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  /** Encerramentos do atendente atual (histórico permanente; inclui conversas reabertas). */
  app.get("/my-attendance", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = myAttendanceQuerySchema.parse(request.query);
    const where: Prisma.ConversationClosureRecordWhereInput = {
      organizationId,
      assignedToId: request.user.id,
    };

    const contactListSelect = {
      id: true,
      name: true,
      phone: true,
      profilePictureUrl: true,
    } as const;

    const [records, total, rollupRows] = await Promise.all([
      prisma.conversationClosureRecord.findMany({
        where,
        include: {
          ...closureRecordInclude,
          conversation: {
            include: {
              contact: { select: contactListSelect },
              messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
            },
          },
        },
        orderBy: { resolvedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.conversationClosureRecord.count({ where }),
      prisma.conversationClosureRecord.findMany({
        where,
        select: {
          conversationId: true,
          sessionIndex: true,
          closureValue: true,
          leadType: { select: { valueRollup: true } },
        },
      }),
    ]);

    const summary = computeClosureRollupTotals(rollupRows);

    return {
      summary,
      data: records.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        sessionIndex: row.sessionIndex,
        status: row.reopenedAt ? "REOPENED" : "RESOLVED",
        resolvedAt: row.resolvedAt.toISOString(),
        reopenedAt: row.reopenedAt?.toISOString() ?? null,
        isNewAttendance: row.isNewAttendance,
        closureValue: row.closureValue,
        closureReason: row.closureReason,
        contact: row.conversation.contact,
        team: row.team,
        leadType: row.leadType,
        messages: row.conversation.messages,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  app.get("/audit", async (request, reply) => {
    if (!isTenantAdmin(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Administrator access required",
        statusCode: 403,
      });
    }
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = auditQuerySchema.parse(request.query);
    const where: Prisma.ConversationClosureRecordWhereInput = {
      organizationId,
    };

    if (query.assignedToId) {
      where.assignedToId = query.assignedToId;
    }
    if (query.teamId) {
      where.teamId = query.teamId;
    }
    if (query.leadTypeId) {
      where.leadTypeId = query.leadTypeId;
    }
    if (query.inboxId) {
      const inbox = await prisma.inbox.findFirst({ where: { id: query.inboxId, organizationId } });
      if (!inbox) {
        return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
      }
      where.conversation = { inboxId: query.inboxId };
    }

    if (query.resolvedFrom || query.resolvedTo) {
      const range: Prisma.DateTimeFilter = {};
      if (query.resolvedFrom) {
        const a = new Date(query.resolvedFrom);
        if (!Number.isNaN(a.getTime())) range.gte = a;
      }
      if (query.resolvedTo) {
        const b = new Date(query.resolvedTo);
        if (!Number.isNaN(b.getTime())) range.lte = b;
      }
      if (Object.keys(range).length > 0) {
        where.resolvedAt = range;
      }
    }

    const contactAuditSelect = {
      id: true,
      name: true,
      phone: true,
      profilePictureUrl: true,
      createdAt: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    } as const;

    const fetchLimit = query.page * query.pageSize;

    const callWhere: Prisma.WavoipCallLogWhereInput = { organizationId };
    const threeCxCallWhere: Prisma.ThreeCxCallLogWhereInput = { organizationId };
    const nvoipCallWhere: Prisma.NvoipCallLogWhereInput = { organizationId };
    if (query.assignedToId) {
      callWhere.initiatedByUserId = query.assignedToId;
      threeCxCallWhere.initiatedByUserId = query.assignedToId;
      nvoipCallWhere.initiatedByUserId = query.assignedToId;
    }
    if (query.inboxId) {
      callWhere.conversation = { inboxId: query.inboxId };
      threeCxCallWhere.conversation = { inboxId: query.inboxId };
      nvoipCallWhere.conversation = { inboxId: query.inboxId };
    }
    if (query.resolvedFrom || query.resolvedTo) {
      const range: Prisma.DateTimeFilter = {};
      if (query.resolvedFrom) {
        const a = new Date(query.resolvedFrom);
        if (!Number.isNaN(a.getTime())) range.gte = a;
      }
      if (query.resolvedTo) {
        const b = new Date(query.resolvedTo);
        if (!Number.isNaN(b.getTime())) range.lte = b;
      }
      if (Object.keys(range).length > 0) {
        const rangeOr = [{ endedAt: range }, { endedAt: null, createdAt: range }];
        callWhere.OR = rangeOr;
        threeCxCallWhere.OR = rangeOr;
        nvoipCallWhere.OR = rangeOr;
      }
    }

    const [
      records,
      closureTotal,
      callLogs,
      callTotal,
      threeCxLogs,
      threeCxTotal,
      nvoipLogs,
      nvoipTotal,
    ] = await Promise.all([
      prisma.conversationClosureRecord.findMany({
        where,
        include: {
          ...closureRecordInclude,
          conversation: {
            include: {
              contact: { select: contactAuditSelect },
              inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
            },
          },
        },
        orderBy: { resolvedAt: "desc" },
        take: fetchLimit,
      }),
      prisma.conversationClosureRecord.count({ where }),
      prisma.wavoipCallLog.findMany({
        where: callWhere,
        include: {
          contact: { select: contactAuditSelect },
          conversation: {
            include: {
              inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
            },
          },
          initiatedByUser: { select: { id: true, name: true, email: true } },
          wavoipDevice: { select: { id: true, name: true } },
        },
        orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
        take: fetchLimit,
      }),
      prisma.wavoipCallLog.count({ where: callWhere }),
      prisma.threeCxCallLog.findMany({
        where: threeCxCallWhere,
        include: {
          contact: { select: contactAuditSelect },
          conversation: {
            include: {
              inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
            },
          },
          initiatedByUser: { select: { id: true, name: true, email: true } },
          threeCxRoutePoint: { select: { id: true, name: true } },
        },
        orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
        take: fetchLimit,
      }),
      prisma.threeCxCallLog.count({ where: threeCxCallWhere }),
      prisma.nvoipCallLog.findMany({
        where: nvoipCallWhere,
        include: {
          contact: { select: contactAuditSelect },
          conversation: {
            include: {
              inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
            },
          },
          initiatedByUser: { select: { id: true, name: true, email: true } },
          nvoipAccount: { select: { id: true, numbersip: true } },
        },
        orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
        take: fetchLimit,
      }),
      prisma.nvoipCallLog.count({ where: nvoipCallWhere }),
    ]);

    const triageByInbox = await buildAgentBotTriageMapForInboxes(
      organizationId,
      records.map((r) => ({ inboxId: r.conversation.inboxId })),
    );

    type AuditEntry = {
      recordType: "closure" | "wavoip_call" | "threecx_call" | "nvoip_call";
      id: string;
      occurredAt: string;
      conversationId: string | null;
      sessionIndex?: number;
      status: string;
      updatedAt: string;
      resolvedAt?: string;
      reopenedAt?: string | null;
      isNewAttendance?: boolean;
      closureValue?: number | null;
      closureReason?: string | null;
      contact: (typeof records)[number]["conversation"]["contact"] | null;
      assignedTo?: (typeof records)[number]["assignedTo"];
      team?: (typeof records)[number]["team"];
      leadType?: (typeof records)[number]["leadType"];
      resolvedBy?: (typeof records)[number]["resolvedBy"];
      reopenedBy?: (typeof records)[number]["reopenedBy"];
      inbox?: (typeof records)[number]["conversation"]["inbox"] | null;
      csatScore?: number | null;
      csatComment?: string | null;
      csatRecordedAt?: string | null;
      agentBotTriageActive?: boolean;
      direction?: string;
      durationSec?: number | null;
      caller?: string;
      receiver?: string;
      deviceName?: string | null;
      initiatedBy?: { id: string; name: string; email: string } | null;
    };

    const closureEntries: AuditEntry[] = records.map((row) => ({
      recordType: "closure" as const,
      id: row.id,
      conversationId: row.conversationId,
      sessionIndex: row.sessionIndex,
      status: row.reopenedAt ? "REOPENED" : "RESOLVED",
      updatedAt: row.resolvedAt.toISOString(),
      occurredAt: row.resolvedAt.toISOString(),
      resolvedAt: row.resolvedAt.toISOString(),
      reopenedAt: row.reopenedAt?.toISOString() ?? null,
      isNewAttendance: row.isNewAttendance,
      closureValue: row.closureValue,
      closureReason: row.closureReason,
      contact: row.conversation.contact,
      assignedTo: row.assignedTo,
      team: row.team,
      leadType: row.leadType,
      resolvedBy: row.resolvedBy,
      reopenedBy: row.reopenedBy,
      inbox: row.conversation.inbox,
      csatScore: row.csatScore,
      csatComment: row.csatComment,
      csatRecordedAt: row.csatRecordedAt?.toISOString() ?? null,
      agentBotTriageActive: triageByInbox.get(row.conversation.inboxId) ?? false,
    }));

    const callEntries: AuditEntry[] = callLogs.map((row) => {
      const occurred = row.endedAt ?? row.createdAt;
      return {
        recordType: "wavoip_call" as const,
        id: row.id,
        conversationId: row.conversationId,
        status: row.status,
        updatedAt: occurred.toISOString(),
        occurredAt: occurred.toISOString(),
        contact: row.contact,
        assignedTo: row.initiatedByUser,
        initiatedBy: row.initiatedByUser,
        inbox: row.conversation?.inbox ?? null,
        direction: row.direction,
        durationSec: row.durationSec,
        caller: row.caller,
        receiver: row.receiver,
        deviceName: row.wavoipDevice?.name ?? null,
      };
    });

    const threeCxEntries: AuditEntry[] = threeCxLogs.map((row) => {
      const occurred = row.endedAt ?? row.createdAt;
      return {
        recordType: "threecx_call" as const,
        id: row.id,
        conversationId: row.conversationId,
        status: row.status,
        updatedAt: occurred.toISOString(),
        occurredAt: occurred.toISOString(),
        contact: row.contact,
        assignedTo: row.initiatedByUser,
        initiatedBy: row.initiatedByUser,
        inbox: row.conversation?.inbox ?? null,
        direction: row.direction,
        durationSec: row.durationSec,
        caller: row.caller,
        receiver: row.receiver,
        deviceName: row.threeCxRoutePoint?.name ?? null,
      };
    });

    const nvoipEntries: AuditEntry[] = nvoipLogs.map((row) => {
      const occurred = row.endedAt ?? row.createdAt;
      return {
        recordType: "nvoip_call" as const,
        id: row.id,
        conversationId: row.conversationId,
        status: row.status,
        updatedAt: occurred.toISOString(),
        occurredAt: occurred.toISOString(),
        contact: row.contact,
        assignedTo: row.initiatedByUser,
        initiatedBy: row.initiatedByUser,
        inbox: row.conversation?.inbox ?? null,
        direction: row.direction,
        durationSec: row.durationSec,
        caller: row.caller,
        receiver: row.receiver,
        deviceName: row.nvoipAccount?.numbersip ?? null,
      };
    });

    const merged = [...closureEntries, ...callEntries, ...threeCxEntries, ...nvoipEntries]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

    return {
      data: merged,
      total: closureTotal + callTotal + threeCxTotal + nvoipTotal,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  /** Marca a conversa como vista pelo utilizador (badge de transferência de equipa). */
  app.post<{ Params: { id: string } }>("/:id/read", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const existing = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true, teamId: true, inboxId: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    if (request.user.role === "AGENT") {
      const ok = await agentCanAccessConversation(request.user.id, organizationId, existing);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    await markConversationReadForUser(prisma, {
      organizationId,
      userId: request.user.id,
      conversationId: existing.id,
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/unread", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const existing = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true, teamId: true, inboxId: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    if (request.user.role === "AGENT") {
      const ok = await agentCanAccessConversation(request.user.id, organizationId, existing);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    await markConversationUnreadForUser(prisma, {
      organizationId,
      userId: request.user.id,
      conversationId: existing.id,
    });
    return reply.status(204).send();
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [requireSuperAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const existing = await prisma.conversation.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
      }

      await prisma.conversation.delete({ where: { id: existing.id } });
      broadcastToOrganization(organizationId, {
        type: "conversation.deleted",
        conversationId: existing.id,
      });
      return reply.status(204).send();
    },
  );

  const suggestReplyBodySchema = z.object({
    currentDraft: z.string().max(16_000).optional(),
  });

  /** Sugestão de resposta (chave OpenAI da organização em Configurações, ou chave global do servidor). */
  app.post<{ Params: { id: string } }>(
    "/:id/suggest-reply",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (request) => {
            const user = (request as { user?: { id: string; actingOrganizationId?: string | null; organizationId?: string | null } }).user;
            const org = user?.actingOrganizationId || user?.organizationId || "anon";
            const key = user?.id || request.ip || "anon";
            return `${key}-${org}`;
          },
        },
      },
    },
    async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const user = (request as { user?: { id: string; role: string } }).user;
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Authentication required", statusCode: 401 });
    }

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
        message:
          "No OpenAI API key available: configure it for this organization in Settings, or set OPENAI_API_KEY / OPENAI_PROMPT_PREVIEW_KEY on the server.",
        code: "missing_openai_key",
        statusCode: 503,
      });
    }

    const parsedBody = suggestReplyBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsedBody.error.message, statusCode: 400 });
    }

    const existing = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      select: {
        id: true,
        teamId: true,
        inboxId: true,
        contact: {
          select: {
            name: true,
            pipelineStage: { select: { name: true } },
            tags: { select: { tag: { select: { name: true } } } },
            dealsPrimary: {
              where: { status: "OPEN" },
              select: { name: true, amountCents: true, status: true, currency: true },
              take: 5,
            },
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { direction: true, body: true, isPrivate: true },
        },
      },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    if (user.role === "AGENT") {
      const ok = await agentCanAccessConversation(user.id, organizationId, existing);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    const transcript = buildPublicConversationTranscript(existing.messages);
    const lang = (request.headers["accept-language"]?.split(",")[0]?.split("-")[0] || "pt") as string;
    try {
      const suggestion = await suggestAgentReplyText(
        {
          contactName: existing.contact.name ?? "",
          transcript,
          currentDraft: parsedBody.data.currentDraft,
          language: lang,
          crmContext: {
            tags: existing.contact.tags.map((t) => t.tag.name),
            pipelineStage: existing.contact.pipelineStage?.name,
            recentDeals: existing.contact.dealsPrimary,
          },
        },
        creds,
      );

      void recordAuditLog({
        actorUserId: user.id,
        organizationId,
        action: "ai.suggest_reply",
        resourceType: "CONVERSATION",
        resourceId: existing.id,
        ip: clientIp(request),
        metadata: {
          contactName: existing.contact.name,
          hasDraft: !!parsedBody.data.currentDraft,
        },
      });

      return { suggestion };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.warn({ err, conversationId: existing.id }, "suggest-reply failed");
      return reply.status(502).send({
        error: "Bad Gateway",
        message: msg.slice(0, 500),
        code: "suggestion_failed",
        statusCode: 502,
      });
    }
  });

  /** Análise IA da conversa — chave da organização ou do servidor. */
  app.post<{ Params: { id: string } }>(
    "/:id/insights",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (request) => {
            const user = (request as { user?: { id: string; actingOrganizationId?: string | null; organizationId?: string | null } }).user;
            const org = user?.actingOrganizationId || user?.organizationId || "anon";
            const key = user?.id || request.ip || "anon";
            return `${key}-${org}`;
          },
        },
      },
    },
    async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const user = (request as { user?: { id: string; role: string } }).user;
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized", message: "Authentication required", statusCode: 401 });
    }

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
        message:
          "No OpenAI API key available: configure it for this organization in Settings, or set OPENAI_API_KEY / OPENAI_PROMPT_PREVIEW_KEY on the server.",
        code: "missing_openai_key",
        statusCode: 503,
      });
    }

    const existing = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      select: {
        id: true,
        teamId: true,
        inboxId: true,
        contact: {
          select: {
            name: true,
            pipelineStage: { select: { name: true } },
            tags: { select: { tag: { select: { name: true } } } },
            dealsPrimary: {
              where: { status: "OPEN" },
              select: { name: true, amountCents: true, status: true, currency: true },
              take: 5,
            },
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { direction: true, body: true, isPrivate: true },
        },
      },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    if (user.role === "AGENT") {
      const ok = await agentCanAccessConversation(user.id, organizationId, existing);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    const transcript = buildPublicConversationTranscript(existing.messages);
    const lang = (request.headers["accept-language"]?.split(",")[0]?.split("-")[0] || "pt") as string;
    try {
      const insights = await analyzeConversationForInsights(
        {
          contactName: existing.contact.name ?? "",
          transcript,
          language: lang,
          crmContext: {
            tags: existing.contact.tags.map((t) => t.tag.name),
            pipelineStage: existing.contact.pipelineStage?.name,
            recentDeals: existing.contact.dealsPrimary,
          },
        },
        creds,
      );

      void recordAuditLog({
        actorUserId: user.id,
        organizationId,
        action: "ai.analyze_insights",
        resourceType: "CONVERSATION",
        resourceId: existing.id,
        ip: clientIp(request),
        metadata: {
          contactName: existing.contact.name,
        },
      });

      // Disparar webhook de alerta se houver riscos ou sentimento negativo
      void dispatchAiAlertWebhook(organizationId, existing.id, insights);

      return { insights };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.warn({ err, conversationId: existing.id }, "conversation insights failed");
      return reply.status(502).send({
        error: "Bad Gateway",
        message: msg.slice(0, 500),
        code: "insights_failed",
        statusCode: 502,
      });
    }
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const conversation = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        contact: {
          include: {
            assignedTo: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
            pipelineStage: {
              select: {
                id: true,
                name: true,
                color: true,
                pipeline: { select: { id: true, name: true } },
              },
            },
          },
        },
        assignedTo: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
        leadType: { select: { id: true, name: true, color: true, valueRollup: true } },
        closureRecords: {
          orderBy: { sessionIndex: "asc" },
          include: closureRecordInclude,
        },
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            actorUser: {
              select: { id: true, name: true, displayName: true, showAgentNameInChat: true },
            },
          },
        },
      },
    });

    if (!conversation) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const ok = await agentCanAccessConversation(request.user.id, organizationId, conversation);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    const contactTimeline = await fetchContactTimelineForConversation(organizationId, conversation.contactId);

    const agentCtx = await getAgentBotDispatchContextForInbox(organizationId, conversation.inboxId);
    const agentBotTriageActive = computeAgentBotTriageActive(agentCtx, conversation.inbox.channelType);
    const contactHasAvatar = await hasContactAvatarCache(organizationId, conversation.contact.id);
    void syncContactProfilePicture({
      organizationId,
      contactId: conversation.contact.id,
      phone: conversation.contact.phone,
      profilePictureUrl: conversation.contact.profilePictureUrl,
    }).catch(() => {});

    const { closureRecords, ...convRest } = conversation;
    const mappedClosureRecords = closureRecords.map((r) => ({
      id: r.id,
      sessionIndex: r.sessionIndex,
      resolvedAt: r.resolvedAt.toISOString(),
      reopenedAt: r.reopenedAt?.toISOString() ?? null,
      isNewAttendance: r.isNewAttendance,
      closureReason: r.closureReason,
      closureValue: r.closureValue,
      csatScore: r.csatScore,
      csatComment: r.csatComment,
      csatRecordedAt: r.csatRecordedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
      reopenedBy: r.reopenedBy,
      assignedTo: r.assignedTo,
      team: r.team,
      leadType: r.leadType,
    }));

    const lastClosure = pickLatestClosureRecord(closureRecords);
    const carryForward =
      conversation.status !== "RESOLVED" &&
      lastClosure != null &&
      shouldCarryForwardClosureValue(lastClosure.leadType?.valueRollup);

    const activeVoiceByConversation = await loadActiveVoiceCallsByConversation(organizationId, [
      conversation.id,
    ]);

    return {
      ...stripCsatSurveyToken(convRest),
      activeVoiceCall: activeVoiceByConversation.get(conversation.id) ?? null,
      contact: {
        ...conversation.contact,
        hasAvatar: contactHasAvatar,
        thumbnail: contactHasAvatar
          ? `/api/v1/contacts/${conversation.contact.id}/profile-picture`
          : null,
      },
      closureRecords: mappedClosureRecords,
      reopenClosureDefaults:
        carryForward && lastClosure
          ? {
              leadTypeId: lastClosure.leadTypeId,
              closureValue: lastClosure.closureValue,
              afterWonSale: false,
            }
          : lastClosure?.leadType?.valueRollup === "WON"
            ? { leadTypeId: null, closureValue: null, afterWonSale: true }
            : null,
      contactTimeline,
      agentBotTriageActive,
    };
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const ok = await agentCanAccessConversation(request.user.id, organizationId, existing);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    if (parsed.data.teamId === null && request.user.role === "AGENT") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Only administrators can return a conversation to the organization pool",
        statusCode: 403,
      });
    }

    if (parsed.data.teamId && parsed.data.teamId !== existing.teamId) {
      const team = await prisma.team.findFirst({
        where: { id: parsed.data.teamId, organizationId },
      });
      if (!team) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid teamId", statusCode: 400 });
      }
      if (request.user.role === "AGENT") {
        const member = await prisma.teamMember.findFirst({
          where: { userId: request.user.id, teamId: parsed.data.teamId, team: { organizationId } },
        });
        if (!member) {
          return reply.status(403).send({
            error: "Forbidden",
            message: "You can only transfer to teams you belong to",
            statusCode: 403,
          });
        }
      }
    }

    if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== null) {
      const assigneeInOrg = await prisma.user.findFirst({
        where: { id: parsed.data.assignedToId, organizationId },
        select: { id: true },
      });
      /** Super admin no tenant (`actingOrganizationId`) costuma ter `organizationId` null em `users`. */
      const superAdminSelfInTenant =
        request.user.role === "SUPER_ADMIN" &&
        !!request.user.actingOrganizationId &&
        parsed.data.assignedToId === request.user.id;
      if (!assigneeInOrg && !superAdminSelfInTenant) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid assignedToId", statusCode: 400 });
      }
      const effectiveTeamAfter =
        parsed.data.teamId !== undefined ? parsed.data.teamId : existing.teamId;
      if (effectiveTeamAfter) {
        const inTeam = await prisma.teamMember.findFirst({
          where: { userId: parsed.data.assignedToId, teamId: effectiveTeamAfter },
        });
        const adminGrabsForSelf =
          isTenantAdmin(request.user) && parsed.data.assignedToId === request.user.id;
        if (!inTeam && !adminGrabsForSelf) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "Assignee must be a member of the conversation team",
            statusCode: 400,
          });
        }
      }
    }

    const nextStatus = parsed.data.status ?? existing.status;

    const tenantSettings = await prisma.settings.findUnique({
      where: { organizationId },
      select: {
        csatEnabled: true,
        csatSurveyMessage: true,
        resolveRequireClosureReason: true,
        resolveRequireLeadType: true,
        silentTransferToAgentBot: true,
      },
    });
    const requireClosureReason = tenantSettings?.resolveRequireClosureReason ?? true;
    const requireLeadType = tenantSettings?.resolveRequireLeadType ?? true;

    if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
      if (existing.status === "OPEN" || existing.status === "PENDING") {
        if (requireClosureReason) {
          const reason =
            typeof parsed.data.closureReason === "string" ? parsed.data.closureReason.trim() : "";
          if (!reason || reason.length < 3) {
            return reply.status(400).send({
              error: "Bad Request",
              message:
                "closureReason is required (min 3 characters) when resolving an open or pending conversation",
              statusCode: 400,
            });
          }
        }

        if (requireLeadType && !parsed.data.leadTypeId) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "leadTypeId is required when resolving an open or pending conversation",
            statusCode: 400,
          });
        }

        const effectiveLeadTypeId = parsed.data.leadTypeId ?? null;
        if (effectiveLeadTypeId) {
          const leadType = await prisma.leadType.findFirst({
            where: { id: effectiveLeadTypeId, organizationId },
          });
          if (!leadType) {
            return reply.status(400).send({
              error: "Bad Request",
              message: "Invalid leadTypeId",
              statusCode: 400,
            });
          }
        }
      }
    }

    const data: {
      status?: typeof nextStatus;
      assignedToId?: string | null;
      teamId?: string | null;
      closureReason?: string | null;
      leadTypeId?: string | null;
      closureValue?: number | null;
      csatScore?: number | null;
      csatComment?: string | null;
      csatRecordedAt?: Date | null;
      csatSurveyToken?: string | null;
      awaitingHumanHandoff?: boolean;
      teamTransferPulseAt?: Date | null;
      priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null;
    } = {};

    if (parsed.data.priority !== undefined) {
      data.priority = parsed.data.priority;
    }
    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
    }
    if (parsed.data.assignedToId !== undefined) {
      data.assignedToId = parsed.data.assignedToId;
    }
    if (parsed.data.teamId !== undefined) {
      data.teamId = parsed.data.teamId;
      if (parsed.data.teamId !== existing.teamId) {
        data.teamTransferPulseAt = parsed.data.teamId ? new Date() : null;
      }
    }
    if (parsed.data.status === "PENDING") {
      data.awaitingHumanHandoff = false;
    } else if (parsed.data.awaitingHumanHandoff === false) {
      data.awaitingHumanHandoff = false;
    }

    if (
      nextStatus === "RESOLVED" &&
      existing.status !== "RESOLVED" &&
      existing.assignedToId == null &&
      parsed.data.assignedToId === undefined
    ) {
      data.assignedToId = request.user.id;
    }

    /** Atribuição humana conclui a fila «aguardando atendimento». */
    if (typeof data.assignedToId === "string" && data.assignedToId.length > 0) {
      data.awaitingHumanHandoff = false;
    }

    if (parsed.data.status === "OPEN" && existing.status === "RESOLVED") {
      data.closureReason = null;
      data.leadTypeId = null;
      data.closureValue = null;
      data.csatScore = null;
      data.csatComment = null;
      data.csatRecordedAt = null;
      data.csatSurveyToken = null;
      data.awaitingHumanHandoff = false;
    } else if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
      if (existing.status === "OPEN" || existing.status === "PENDING") {
        const rawCr = parsed.data.closureReason;
        const trimmedReason = typeof rawCr === "string" ? rawCr.trim() : "";
        data.closureReason = requireClosureReason
          ? trimmedReason
          : trimmedReason.length > 0
            ? trimmedReason
            : null;
        data.leadTypeId = requireLeadType ? parsed.data.leadTypeId! : (parsed.data.leadTypeId ?? null);
        if (parsed.data.closureValue !== undefined && parsed.data.closureValue !== null) {
          data.closureValue = parsed.data.closureValue;
        } else {
          data.closureValue = null;
        }
        if (tenantSettings?.csatEnabled) {
          data.csatSurveyToken = newCsatSurveyToken();
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "No fields to update",
        statusCode: 400,
      });
    }

    const prevTeamId = existing.teamId;
    const prevAssignedToId = existing.assignedToId;

    try {
      const { conversation, timelineDeal, timelineReminder, closureRecordId } =
        await prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.update({
          where: { id: request.params.id },
          data,
          include: {
            contact: {
              include: {
                assignedTo: { select: { id: true, name: true } },
                createdBy: { select: { id: true, name: true } },
              },
            },
            assignedTo: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
            inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
            leadType: { select: { id: true, name: true, color: true, valueRollup: true } },
            closureRecords: {
              orderBy: { sessionIndex: "asc" },
              include: closureRecordInclude,
            },
            messages: {
              orderBy: { createdAt: "asc" },
              include: {
                actorUser: {
                  select: { id: true, name: true, displayName: true, showAgentNameInChat: true },
                },
              },
            },
          },
        });

        let dealMeta: { id: string; name: string; primaryContactId: string | null } | null = null;
        let reminderMeta: { id: string; dueAt: Date } | null = null;
        let createdClosureRecordId: string | null = null;

        if (parsed.data.status === "OPEN" && existing.status === "RESOLVED") {
          await markConversationClosureReopened(tx, {
            conversationId: existing.id,
            reopenedById: request.user.id,
          });
        }

        if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
          const ltid = data.leadTypeId;
          let stageForDeal: { id: string; probabilityPct: number } | null = null;
          let ltPlaybook: Awaited<ReturnType<typeof loadLeadTypePlaybook>> = null;

          if (ltid) {
            ltPlaybook = await loadLeadTypePlaybook(tx, ltid, organizationId);
            stageForDeal = await applyContactStageForLeadType(
              tx,
              organizationId,
              existing.contactId,
              ltid,
            );
          }

          if (existing.status === "OPEN" || existing.status === "PENDING") {
            const effectiveAssignee =
              data.assignedToId !== undefined ? data.assignedToId : conv.assignedToId;
            const closureRow = await createConversationClosureRecord(tx, {
              organizationId,
              conversationId: existing.id,
              resolvedById: request.user.id,
              assignedToId: effectiveAssignee,
              teamId: conv.teamId,
              leadTypeId: data.leadTypeId ?? null,
              closureReason: data.closureReason ?? null,
              closureValue: data.closureValue ?? null,
            });
            createdClosureRecordId = closureRow.id;

            if (ltid && stageForDeal && ltPlaybook && createdClosureRecordId) {
              dealMeta = await maybeCreateDealOnConversationClosure(tx, {
                organizationId,
                conversationId: existing.id,
                closureRecordId: createdClosureRecordId,
                contactId: existing.contactId,
                ownerUserId: request.user.id,
                leadTypeId: ltid,
                closureValue: data.closureValue,
                stage: stageForDeal,
                valueRollup: ltPlaybook.valueRollup,
                playbook: ltPlaybook.playbook,
              });
            }

            if (parsed.data.resolveReminder && createdClosureRecordId) {
              reminderMeta = await maybeCreateReminderOnConversationClosure(tx, {
                organizationId,
                conversationId: existing.id,
                closureRecordId: createdClosureRecordId,
                contactId: existing.contactId,
                userId: request.user.id,
                note: parsed.data.resolveReminder.note,
                dueAt: new Date(parsed.data.resolveReminder.dueAt),
              });
            }
          }
        }

        return {
          conversation: conv,
          timelineDeal: dealMeta,
          timelineReminder: reminderMeta,
          closureRecordId: createdClosureRecordId,
        };
      });

      if (
        nextStatus === "RESOLVED" &&
        existing.status !== "RESOLVED" &&
        (existing.status === "OPEN" || existing.status === "PENDING")
      ) {
        try {
          await clearAutomationConversationContext(organizationId, conversation.id);
        } catch (err) {
          app.log.warn(
            { err, conversationId: conversation.id },
            "clear automation context on conversation resolve failed",
          );
        }
      }

      if (timelineDeal) {
        await appendTimelineEvent({
          organizationId,
          subjectType: "DEAL",
          subjectId: timelineDeal.id,
          eventType: "deal.created",
          payload: {
            dealId: timelineDeal.id,
            name: timelineDeal.name,
            source: "conversation_closure",
          },
          actorUserId: request.user.id,
        });
        if (timelineDeal.primaryContactId) {
          await appendTimelineEvent({
            organizationId,
            subjectType: "CONTACT",
            subjectId: timelineDeal.primaryContactId,
            eventType: "deal.linked",
            payload: { dealId: timelineDeal.id, name: timelineDeal.name },
            actorUserId: request.user.id,
          });
        }
        fireCrmFlowTriggers(
          organizationId,
          "deal_created",
          {
            dealId: timelineDeal.id,
            contactId: timelineDeal.primaryContactId,
            conversationId: conversation.id,
          },
          app.log,
        );
      }

      if (
        nextStatus === "RESOLVED" &&
        existing.status !== "RESOLVED" &&
        (existing.status === "OPEN" || existing.status === "PENDING")
      ) {
        await appendTimelineEvent({
          organizationId,
          subjectType: "CONTACT",
          subjectId: existing.contactId,
          eventType: "conversation.resolved",
          channel: "conversation",
          payload: {
            conversationId: conversation.id,
            leadTypeId: conversation.leadTypeId,
            leadTypeName: conversation.leadType?.name ?? null,
            closureReason: conversation.closureReason,
            closureValue: conversation.closureValue,
            closureRecordId,
            dealId: timelineDeal?.id ?? null,
            reminderId: timelineReminder?.id ?? null,
          } as Prisma.InputJsonValue,
          actorUserId: request.user.id,
          sourceId: conversation.id,
        });

        fireCrmFlowTriggers(
          organizationId,
          "conversation_closed",
          {
            conversationId: conversation.id,
            contactId: existing.contactId,
            inboxId: conversation.inboxId,
            leadTypeId: conversation.leadTypeId,
            closureReason: conversation.closureReason,
            closureValue: conversation.closureValue,
            assignedToId: conversation.assignedToId,
            dealId: timelineDeal?.id ?? null,
            reminderId: timelineReminder?.id ?? null,
          },
          app.log,
        );

        if (timelineReminder) {
          fireCrmFlowTriggers(
            organizationId,
            "event_created",
            {
              reminderId: timelineReminder.id,
              contactId: existing.contactId,
              userId: request.user.id,
              conversationId: conversation.id,
              dueAt: timelineReminder.dueAt.toISOString(),
            },
            app.log,
          );
        }
      }

      if (
        nextStatus === "RESOLVED" &&
        existing.status !== "RESOLVED" &&
        (existing.status === "OPEN" || existing.status === "PENDING") &&
        tenantSettings?.csatEnabled &&
        conversation.csatSurveyToken
      ) {
        const intro = tenantSettings.csatSurveyMessage?.trim() ?? "";
        const bodyText = buildCsatWhatsAppBody(intro, conversation.csatSurveyToken);
        try {
          await deliverOutboundWhatsAppMessage({
            organizationId,
            data: {
              contactId: existing.contactId,
              type: "TEXT",
              body: bodyText,
            },
            actor: { kind: "user", userId: request.user.id },
            log: app.log,
            newConversation: { status: "OPEN", assignedToId: request.user.id },
            pinnedConversationId: conversation.id,
          });
        } catch (err) {
          app.log.warn({ err }, "CSAT survey WhatsApp send failed");
        }
      }

      const wasBotQueue = existing.status === "PENDING" && existing.assignedToId == null;
      const nowBotQueue = conversation.status === "PENDING" && conversation.assignedToId == null;
      if (nowBotQueue && !wasBotQueue && !tenantSettings?.silentTransferToAgentBot) {
        const ch = await getAgentBotDispatchContextForInbox(organizationId, conversation.inboxId);
        if (ch) {
          const lastInbound = await prisma.message.findFirst({
            where: { conversationId: conversation.id, direction: "INBOUND" },
            orderBy: { createdAt: "desc" },
          });
          if (lastInbound) {
            const contactRow = await prisma.contact.findFirst({
              where: { id: conversation.contactId, organizationId },
            });
            if (contactRow) {
              void dispatchAgentBotWebhook({
                organizationId,
                settings: { agentBotId: ch.agentBotId, agentBot: ch.agentBot },
                conversation,
                contact: contactRow,
                message: lastInbound,
                log: app.log,
              });
            }
          }
        }
      }

      const teamChanged = conversation.teamId !== prevTeamId;
      const assigneeChanged = conversation.assignedToId !== prevAssignedToId;
      if (teamChanged || assigneeChanged) {
        let previousTeamName: string | null = null;
        if (prevTeamId) {
          const pt = await prisma.team.findFirst({
            where: { id: prevTeamId },
            select: { name: true },
          });
          previousTeamName = pt?.name ?? null;
        }
        let previousAssigneeName: string | null = null;
        if (prevAssignedToId) {
          const pu = await prisma.user.findFirst({
            where: { id: prevAssignedToId },
            select: { name: true },
          });
          previousAssigneeName = pu?.name ?? null;
        }

        await appendTimelineEvent({
          organizationId,
          subjectType: "CONTACT",
          subjectId: existing.contactId,
          eventType: "conversation.handoff",
          channel: "conversation",
          payload: {
            conversationId: conversation.id,
            previousTeamId: prevTeamId,
            previousTeamName,
            newTeamId: conversation.teamId,
            newTeamName: conversation.team?.name ?? null,
            previousAssigneeId: prevAssignedToId,
            previousAssigneeName,
            newAssigneeId: conversation.assignedToId,
            newAssigneeName: conversation.assignedTo?.name ?? null,
          } as Prisma.InputJsonValue,
          actorUserId: request.user.id,
          sourceId: conversation.id,
        });

        broadcastToOrganization(organizationId, {
          type: "conversation.transferred",
          conversationId: conversation.id,
          teamId: conversation.teamId,
          teamName: conversation.team?.name ?? null,
          previousTeamId: prevTeamId,
          assignedToId: conversation.assignedToId,
          previousAssignedToId: prevAssignedToId,
          contact: conversation.contact,
        });
      }

      if (existing.awaitingHumanHandoff !== conversation.awaitingHumanHandoff) {
        broadcastToOrganization(organizationId, {
          type: "conversation.updated",
          conversationId: conversation.id,
          awaitingHumanHandoff: conversation.awaitingHumanHandoff,
        });
      }

      const contactTimeline = await fetchContactTimelineForConversation(organizationId, conversation.contactId);

      const agentCtxPut = await getAgentBotDispatchContextForInbox(organizationId, conversation.inboxId);
      const agentBotTriageActive = computeAgentBotTriageActive(agentCtxPut, conversation.inbox.channelType);
      const { closureRecords, ...convBody } = conversation;
      return {
        ...stripCsatSurveyToken(convBody),
        closureRecords: closureRecords.map((r) => ({
          id: r.id,
          sessionIndex: r.sessionIndex,
          resolvedAt: r.resolvedAt.toISOString(),
          reopenedAt: r.reopenedAt?.toISOString() ?? null,
          isNewAttendance: r.isNewAttendance,
          closureReason: r.closureReason,
          closureValue: r.closureValue,
          csatScore: r.csatScore,
          csatComment: r.csatComment,
          csatRecordedAt: r.csatRecordedAt?.toISOString() ?? null,
          resolvedBy: r.resolvedBy,
          reopenedBy: r.reopenedBy,
          assignedTo: r.assignedTo,
          team: r.team,
          leadType: r.leadType,
        })),
        contactTimeline,
        agentBotTriageActive,
      };
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
  });
}
