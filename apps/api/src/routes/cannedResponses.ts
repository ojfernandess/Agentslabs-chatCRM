import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

function normalizeShortcut(raw: string): string {
  return raw.trim().replace(/^\/+/, "").toLowerCase();
}

const cannedBodySchema = z.object({
  shortcut: z.string().min(1).max(50),
  content: z.string().min(1).max(10_000),
});

export async function cannedResponseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.cannedResponse.findMany({
      where: { organizationId },
      orderBy: { shortcut: "asc" },
    });
  });

  await app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.post("/", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = cannedBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const shortcut = normalizeShortcut(parsed.data.shortcut);
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(shortcut)) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Shortcut must start with a letter or number and contain only letters, numbers, _ or -",
          statusCode: 400,
        });
      }

      try {
        const row = await prisma.cannedResponse.create({
          data: {
            organizationId,
            shortcut,
            content: parsed.data.content.trim(),
          },
        });
        return reply.status(201).send(row);
      } catch {
        return reply.status(409).send({
          error: "Conflict",
          message: "A canned response with this shortcut already exists",
          statusCode: 409,
        });
      }
    });

    admin.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = cannedBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const shortcut = normalizeShortcut(parsed.data.shortcut);
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(shortcut)) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Shortcut must start with a letter or number and contain only letters, numbers, _ or -",
          statusCode: 400,
        });
      }

      try {
        const res = await prisma.cannedResponse.updateMany({
          where: { id: request.params.id, organizationId },
          data: { shortcut, content: parsed.data.content.trim() },
        });
        if (res.count === 0) {
          return reply.status(404).send({ error: "Not Found", message: "Canned response not found", statusCode: 404 });
        }
        return prisma.cannedResponse.findFirst({ where: { id: request.params.id, organizationId } });
      } catch {
        return reply.status(409).send({
          error: "Conflict",
          message: "A canned response with this shortcut already exists",
          statusCode: 409,
        });
      }
    });

    admin.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const res = await prisma.cannedResponse.deleteMany({
        where: { id: request.params.id, organizationId },
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Canned response not found", statusCode: 404 });
      }
      return reply.status(204).send();
    });
  });
}
