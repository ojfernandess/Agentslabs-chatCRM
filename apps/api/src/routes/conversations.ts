import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  since: z.string().optional(),
});

const updateSchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "PENDING"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  closureReason: z.string().min(3).max(4000).optional(),
  leadTypeId: z.string().uuid().optional(),
});

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = querySchema.parse(request.query);
    const where: Record<string, unknown> = { organizationId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.since) {
      const d = new Date(query.since);
      if (!Number.isNaN(d.getTime())) {
        where.updatedAt = { gt: d };
      }
    }

    if (request.user.role === "AGENT") {
      where.assignedToId = request.user.id;
    }

    const [data, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true } },
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

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const conversation = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        contact: true,
        assignedTo: { select: { id: true, name: true } },
        leadType: { select: { id: true, name: true, color: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT" && conversation.assignedToId !== request.user.id) {
      return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
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

    if (request.user.role === "AGENT" && existing.assignedToId !== request.user.id) {
      return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
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
      closureReason?: string | null;
      leadTypeId?: string | null;
    } = {};

    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
    }
    if (parsed.data.assignedToId !== undefined) {
      data.assignedToId = parsed.data.assignedToId;
    }

    if (parsed.data.status === "OPEN" && existing.status === "RESOLVED") {
      data.closureReason = null;
      data.leadTypeId = null;
    } else if (nextStatus === "RESOLVED" && existing.status !== "RESOLVED") {
      if (existing.status === "OPEN" || existing.status === "PENDING") {
        data.closureReason = parsed.data.closureReason!.trim();
        data.leadTypeId = parsed.data.leadTypeId!;
      }
    }

    try {
      const conversation = await prisma.conversation.update({
        where: { id: request.params.id },
        data,
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true } },
          leadType: { select: { id: true, name: true, color: true } },
        },
      });
      return conversation;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
  });
}
