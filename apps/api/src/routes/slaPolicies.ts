import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { slaMinutesFromInput } from "../lib/slaTime.js";

const timeFieldSchema = z.object({
  value: z.number().int().min(1),
  unit: z.enum(["minutes", "hours", "days"]),
});

const slaBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.union([z.string().max(2000), z.literal(""), z.null()]).optional(),
  firstResponseTime: timeFieldSchema,
  nextResponseTime: timeFieldSchema,
  resolutionTime: timeFieldSchema,
  onlyDuringBusinessHours: z.boolean().optional(),
});

function mapSlaBody(body: z.infer<typeof slaBodySchema>) {
  const description = body.description === "" ? null : (body.description?.trim() ?? null);
  return {
    name: body.name.trim(),
    description,
    firstResponseTimeMinutes: slaMinutesFromInput(body.firstResponseTime.value, body.firstResponseTime.unit),
    nextResponseTimeMinutes: slaMinutesFromInput(body.nextResponseTime.value, body.nextResponseTime.unit),
    resolutionTimeMinutes: slaMinutesFromInput(body.resolutionTime.value, body.resolutionTime.unit),
    onlyDuringBusinessHours: body.onlyDuringBusinessHours ?? false,
  };
}

export async function slaPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.slaPolicy.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  });

  await app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.post("/", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = slaBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const row = await prisma.slaPolicy.create({
        data: { organizationId, ...mapSlaBody(parsed.data) },
      });
      return reply.status(201).send(row);
    });

    admin.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = slaBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const res = await prisma.slaPolicy.updateMany({
        where: { id: request.params.id, organizationId },
        data: mapSlaBody(parsed.data),
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "SLA policy not found", statusCode: 404 });
      }
      return prisma.slaPolicy.findFirst({ where: { id: request.params.id, organizationId } });
    });

    admin.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const res = await prisma.slaPolicy.deleteMany({
        where: { id: request.params.id, organizationId },
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "SLA policy not found", statusCode: 404 });
      }
      return reply.status(204).send();
    });
  });
}
