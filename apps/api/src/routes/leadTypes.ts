import { FastifyInstance } from "fastify";
import { z } from "zod";
import { LeadValueRollup } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticateSessionOrUserApiTokenForApplicationApis, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  ensurePipelineStageForLeadType,
  syncPipelineStageFromLeadType,
} from "../lib/pipelineLeadTypeSync.js";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  order: z.number().int().min(0).optional(),
  valueRollup: z.nativeEnum(LeadValueRollup).optional(),
});

async function enforceSingleWonType(organizationId: string, keepId: string): Promise<void> {
  await prisma.leadType.updateMany({
    where: { organizationId, id: { not: keepId }, valueRollup: "WON" },
    data: { valueRollup: "PIPELINE" },
  });
}

export async function leadTypeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticateSessionOrUserApiTokenForApplicationApis] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.leadType.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
  });

  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const maxOrder = await prisma.leadType.aggregate({
      where: { organizationId },
      _max: { order: true },
    });
    const order = parsed.data.order ?? (maxOrder._max.order ?? -1) + 1;
    const valueRollup = parsed.data.valueRollup ?? "PIPELINE";
    const row = await prisma.leadType.create({
      data: {
        organizationId,
        name: parsed.data.name.trim(),
        color: parsed.data.color,
        order,
        valueRollup,
      },
    });
    if (valueRollup === "WON") {
      await enforceSingleWonType(organizationId, row.id);
    }
    return reply.status(201).send(row);
  });

  app.put<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.leadType.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Lead type not found", statusCode: 404 });
    }
    const order = parsed.data.order ?? existing.order;
    const valueRollup = parsed.data.valueRollup ?? existing.valueRollup;
    const row = await prisma.leadType.update({
      where: { id: request.params.id },
      data: {
        name: parsed.data.name.trim(),
        color: parsed.data.color,
        order,
        valueRollup,
      },
    });
    if (valueRollup === "WON") {
      await enforceSingleWonType(organizationId, row.id);
    }
    await syncPipelineStageFromLeadType(prisma, organizationId, row.id);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.leadType.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Lead type not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
