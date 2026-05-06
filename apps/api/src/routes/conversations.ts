import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import type { JwtPayload } from "../middleware/auth.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { broadcastToOrganization } from "../lib/workspaceHub.js";
import type { Prisma } from "@prisma/client";
import { appendTimelineEvent } from "../lib/timeline.js";
import { getOrCreateDefaultPipeline } from "../lib/defaultPipeline.js";
import { ensurePipelineStageForLeadType } from "../lib/pipelineLeadTypeSync.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  since: z.string().optional(),
  teamId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  leadTypeId: z.string().uuid().optional(),
  mine: z.enum(["1", "true", "0", "false"]).optional(),
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).default("RESOLVED"),
  assignedToId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  leadTypeId: z.string().uuid().optional(),
  resolvedFrom: z.string().optional(),
  resolvedTo: z.string().optional(),
});

const updateSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  closureReason: z.string().min(3).max(4000).optional(),
  leadTypeId: z.string().uuid().optional(),
  closureValue: z.number().nonnegative().nullable().optional(),
});

async function agentHasConversationAccess(
  userId: string,
  conv: { assignedToId: string | null; teamId: string | null },
): Promise<boolean> {
  if (conv.assignedToId === userId) return true;
  if (!conv.teamId) return false;
  const m = await prisma.teamMember.findFirst({
    where: { userId, teamId: conv.teamId },
  });
  return !!m;
}

function isTenantAdmin(user: JwtPayload): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

function isMineFlag(v: string | undefined): boolean {
  return v === "1" || v === "true";
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
          { assignedToId: request.user.id },
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
          leadType: { select: { id: true, name: true, color: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);

    return { data, total, page: query.page, pageSize: query.pageSize };
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
          leadType: { select: { id: true, name: true, color: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);

    return { data, total, page: query.page, pageSize: query.pageSize };
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
          },
        },
        assignedTo: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        leadType: { select: { id: true, name: true, color: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const ok = await agentHasConversationAccess(request.user.id, conversation);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    return conversation;
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
      const ok = await agentHasConversationAccess(request.user.id, existing);
      if (!ok) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    if (parsed.data.teamId !== undefined && !isTenantAdmin(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Only administrators can assign conversations to a team",
        statusCode: 403,
      });
    }

    if (parsed.data.teamId) {
      const team = await prisma.team.findFirst({
        where: { id: parsed.data.teamId, organizationId },
      });
      if (!team) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid teamId", statusCode: 400 });
      }
    }

    const nextStatus = parsed.data.status ?? existing.status;

    if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
      if (existing.status === "OPEN" || existing.status === "PENDING") {
        const reason = parsed.data.closureReason?.trim();
        if (!reason || reason.length < 3) {
          return reply.status(400).send({
            error: "Bad Request",
            message:
              "closureReason is required (min 3 characters) when resolving an open or pending conversation",
            statusCode: 400,
          });
        }

        if (!parsed.data.leadTypeId) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "leadTypeId is required when resolving an open or pending conversation",
            statusCode: 400,
          });
        }

        const leadType = await prisma.leadType.findFirst({
          where: { id: parsed.data.leadTypeId, organizationId },
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

    const data: {
      status?: typeof nextStatus;
      assignedToId?: string | null;
      teamId?: string | null;
      closureReason?: string | null;
      leadTypeId?: string | null;
      closureValue?: number | null;
    } = {};

    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
    }
    if (parsed.data.assignedToId !== undefined) {
      data.assignedToId = parsed.data.assignedToId;
    }
    if (parsed.data.teamId !== undefined) {
      data.teamId = parsed.data.teamId;
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
    } else if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
      if (existing.status === "OPEN" || existing.status === "PENDING") {
        data.closureReason = parsed.data.closureReason!.trim();
        data.leadTypeId = parsed.data.leadTypeId!;
        if (parsed.data.closureValue !== undefined && parsed.data.closureValue !== null) {
          data.closureValue = parsed.data.closureValue;
        } else {
          data.closureValue = null;
        }
      }
    }

    const prevTeamId = existing.teamId;

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
            leadType: { select: { id: true, name: true, color: true } },
            messages: { orderBy: { createdAt: "asc" } },
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
          }
          const val = data.closureValue;
          if (val != null && val > 0 && ltid && stageForDeal) {
            const pipeline = await getOrCreateDefaultPipeline(tx, organizationId);
            const contactRow = await tx.contact.findFirst({
              where: { id: existing.contactId, organizationId },
              select: { name: true },
            });
            const deal = await tx.deal.create({
              data: {
                organizationId,
                name: `Negócio — ${contactRow?.name ?? "Contacto"}`,
                pipelineId: pipeline.id,
                stageId: stageForDeal.id,
                primaryContactId: existing.contactId,
                ownerId: request.user.id,
                amountCents: Math.round(val * 100),
                currency: "EUR",
                status: "OPEN",
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

      if (parsed.data.teamId !== undefined && parsed.data.teamId !== prevTeamId) {
        broadcastToOrganization(organizationId, {
          type: "conversation.transferred",
          conversationId: conversation.id,
          teamId: conversation.teamId,
          previousTeamId: prevTeamId,
          contact: conversation.contact,
        });
      }

      return conversation;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
  });
}
