import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";

const stageSchema = z.object({
  name: z.string().min(1).max(100),
  order: z.number().int().min(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const BOARD_CONTACT_LIMIT = 500;

async function requireCrmKanban(
  organizationId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const enabled = await isOrganizationFeatureEnabled(organizationId, "crm_kanban");
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Funil CRM está desativado para esta organização.",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/board", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;

    const where: Record<string, unknown> = { organizationId };
    if (request.user.role === "AGENT") {
      where.assignedToId = request.user.id;
    }

    const [stages, contacts] = await Promise.all([
      prisma.pipelineStage.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      }),
      prisma.contact.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          pipelineStage: true,
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: BOARD_CONTACT_LIMIT,
      }),
    ]);

    return { stages, contacts };
  });

  app.get("/stages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;
    return prisma.pipelineStage.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
  });

  app.post("/stages", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;

    const parsed = stageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const stage = await prisma.pipelineStage.create({
      data: { ...parsed.data, organizationId },
    });
    return reply.status(201).send(stage);
  });

  app.put<{ Params: { id: string } }>("/stages/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;

    const parsed = stageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const res = await prisma.pipelineStage.updateMany({
      where: { id: request.params.id, organizationId },
      data: parsed.data,
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Stage not found", statusCode: 404 });
    }
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: request.params.id, organizationId },
    });
    return stage;
  });

  app.delete<{ Params: { id: string } }>("/stages/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;

    const res = await prisma.pipelineStage.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Stage not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
