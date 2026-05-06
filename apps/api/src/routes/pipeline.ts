import { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { ensurePipelineStageForLeadType } from "../lib/pipelineLeadTypeSync.js";

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

    const leadTypes = await prisma.leadType.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
    await Promise.all(
      leadTypes.map((lt) => ensurePipelineStageForLeadType(prisma, organizationId, lt.id)),
    );

    const stages = leadTypes.map((lt) => ({
      id: lt.id,
      name: lt.name,
      order: lt.order,
      color: lt.color,
    }));

    const contacts = await prisma.contact.findMany({
      where,
      include: {
        tags: { include: { tag: true } },
        pipelineStage: true,
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: BOARD_CONTACT_LIMIT,
    });

    return { stages, contacts };
  });

  app.get("/stages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;

    const leadTypes = await prisma.leadType.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
    await Promise.all(
      leadTypes.map((lt) => ensurePipelineStageForLeadType(prisma, organizationId, lt.id)),
    );
    return leadTypes.map((lt) => ({
      id: lt.id,
      name: lt.name,
      order: lt.order,
      color: lt.color,
    }));
  });

  app.post("/stages", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;
    return reply.status(400).send({
      error: "Bad Request",
      message:
        "As colunas do funil vêm dos Tipos de lead. Crie ou edite tipos em Configurações → Tipos de lead.",
      statusCode: 400,
    });
  });

  app.put<{ Params: { id: string } }>("/stages/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;
    return reply.status(400).send({
      error: "Bad Request",
      message:
        "As colunas do funil vêm dos Tipos de lead. Edite-os em Configurações → Tipos de lead.",
      statusCode: 400,
    });
  });

  app.delete<{ Params: { id: string } }>("/stages/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmKanban(organizationId, reply))) return;
    return reply.status(400).send({
      error: "Bad Request",
      message:
        "Para remover uma coluna, apague o tipo de lead correspondente em Configurações (contactos no estágio ficam sem coluna).",
      statusCode: 400,
    });
  });
}
