import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(4096),
  providerTemplateId: z.string().max(255).optional(),
  isApproved: z.boolean().optional(),
});

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.messageTemplate.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const template = await prisma.messageTemplate.create({
      data: { ...parsed.data, organizationId },
    });
    return reply.status(201).send(template);
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const res = await prisma.messageTemplate.updateMany({
      where: { id: request.params.id, organizationId },
      data: parsed.data,
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
    }
    return prisma.messageTemplate.findFirst({
      where: { id: request.params.id, organizationId },
    });
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.messageTemplate.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
