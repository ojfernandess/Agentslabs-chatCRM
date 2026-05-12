import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import type { JwtPayload } from "../middleware/auth.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { broadcastToOrganization } from "../lib/workspaceHub.js";
import type { InboxChannelType, Prisma } from "@prisma/client";
import { appendTimelineEvent } from "../lib/timeline.js";
import { getOrCreateDefaultPipeline } from "../lib/defaultPipeline.js";
import { ensurePipelineStageForLeadType } from "../lib/pipelineLeadTypeSync.js";
import { dealStatusFromLeadValueRollup, syncDealsForContactPipelineStage } from "../lib/dealStageSync.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";
import { buildCsatWhatsAppBody, newCsatSurveyToken } from "../lib/csatSurvey.js";
import { dispatchAgentBotWebhook } from "../lib/agentBotWebhook.js";
import { computeAgentBotTriageActive, getAgentBotDispatchContextForInbox } from "../lib/agentBotTriage.js";
import { markConversationReadForUser } from "../lib/teamTransferUnread.js";

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

const updateSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  closureReason: z.union([z.string().max(4000), z.null()]).optional(),
  leadTypeId: z.union([z.string().uuid(), z.null()]).optional(),
  closureValue: z.number().nonnegative().nullable().optional(),
  awaitingHumanHandoff: z.literal(false).optional(),
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

    if (query.status) {
      where.status = query.status;
    }

    if (query.since) {
      const d = new Date(query.since);
      if (!Number.isNaN(d.getTime())) {
        where.updatedAt = { gt: d };
      }
    }

    if (query.leadTypeId) {
      where.leadTypeId = query.leadTypeId;
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

    const mine = isMineFlag(query.mine);
    const effectiveAssigneeId = mine ? request.user.id : query.assignedToId;

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

    return {
      data: data.map((row) => ({
        ...stripCsatSurveyToken(row),
        agentBotTriageActive: triageByInbox.get(row.inboxId) ?? false,
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
    const where: Prisma.ConversationWhereInput = {
      organizationId,
      status: query.status,
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
      where.inboxId = query.inboxId;
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
        where.updatedAt = range;
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

    const [data, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: contactAuditSelect },
          assignedTo: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
          inbox: { select: { id: true, name: true, isDefault: true, channelType: true } },
          leadType: { select: { id: true, name: true, color: true, valueRollup: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);

    const triageByInbox = await buildAgentBotTriageMapForInboxes(organizationId, data);

    return {
      data: data.map((row) => ({
        ...stripCsatSurveyToken(row),
        agentBotTriageActive: triageByInbox.get(row.inboxId) ?? false,
      })),
      total,
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
        messages: {
          orderBy: { createdAt: "asc" },
          include: { actorUser: { select: { id: true, name: true, displayName: true } } },
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
    return { ...stripCsatSurveyToken(conversation), contactTimeline, agentBotTriageActive };
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
    } = {};

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
      const { conversation, timelineDeal } = await prisma.$transaction(async (tx) => {
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
            messages: {
              orderBy: { createdAt: "asc" },
              include: { actorUser: { select: { id: true, name: true, displayName: true } } },
            },
          },
        });

        let dealMeta: { id: string; name: string; primaryContactId: string | null } | null = null;

        if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
          const ltid = data.leadTypeId;
          let stageForDeal: { id: string; probabilityPct: number } | null = null;
          if (ltid) {
            const stage = await ensurePipelineStageForLeadType(tx, organizationId, ltid);
            stageForDeal = { id: stage.id, probabilityPct: stage.probabilityPct };
            await tx.contact.update({
              where: { id: existing.contactId },
              data: { pipelineStageId: stage.id },
            });
            await syncDealsForContactPipelineStage(tx, organizationId, existing.contactId, stage.id);
          }
          const val = data.closureValue;
          if (val != null && val > 0 && ltid && stageForDeal) {
            const pipeline = await getOrCreateDefaultPipeline(tx, organizationId);
            const contactRow = await tx.contact.findFirst({
              where: { id: existing.contactId, organizationId },
              select: { name: true },
            });
            const ltRow = await tx.leadType.findFirst({
              where: { id: ltid, organizationId },
              select: { valueRollup: true },
            });
            const dealStatus = dealStatusFromLeadValueRollup(ltRow?.valueRollup);
            const deal = await tx.deal.create({
              data: {
                organizationId,
                name: `Negócio — ${contactRow?.name ?? "Contacto"}`,
                pipelineId: pipeline.id,
                stageId: stageForDeal.id,
                primaryContactId: existing.contactId,
                ownerId: request.user.id,
                amountCents: Math.round(val * 100),
                currency: "BRL",
                status: dealStatus,
                probabilityPct: stageForDeal.probabilityPct,
              },
            });
            dealMeta = {
              id: deal.id,
              name: deal.name,
              primaryContactId: deal.primaryContactId,
            };
          }
        }

        return { conversation: conv, timelineDeal: dealMeta };
      });

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
      return { ...stripCsatSurveyToken(conversation), contactTimeline, agentBotTriageActive };
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
  });
}
