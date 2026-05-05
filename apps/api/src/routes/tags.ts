import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { isValidHexColor } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const tagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.tag.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = tagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    if (!isValidHexColor(parsed.data.color)) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid color format", statusCode: 400 });
    }

    try {
      const tag = await prisma.tag.create({
        data: { ...parsed.data, organizationId },
      });
      return reply.status(201).send(tag);
    } catch {
      return reply.status(409).send({ error: "Conflict", message: "Tag with this name already exists", statusCode: 409 });
    }
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = tagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      const tag = await prisma.tag.updateMany({
        where: { id: request.params.id, organizationId },
        data: parsed.data,
      });
      if (tag.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Tag not found", statusCode: 404 });
      }
      const updated = await prisma.tag.findFirst({
        where: { id: request.params.id, organizationId },
      });
      return updated;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Tag not found", statusCode: 404 });
    }
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.tag.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Tag not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
