import { FastifyInstance } from "fastify";
import { z } from "zod";
import { LeadValueRollup, Prisma } from "@prisma/client";
import { parseLeadTypeClosurePlaybook } from "@openconduit/shared";
import { prisma } from "../db.js";
import { authenticateSessionOrUserApiTokenForApplicationApis, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  ensurePipelineStageForLeadType,
  syncPipelineStageFromLeadType,
} from "../lib/pipelineLeadTypeSync.js";
import { getOrCreateDefaultPipeline } from "../lib/defaultPipeline.js";

const closurePlaybookSchema = z
  .object({
    suggestReminder: z.boolean().optional(),
    reminderDueDays: z.number().int().min(0).max(365).optional(),
    reminderNoteTemplate: z.string().max(500).optional(),
    createDealWithoutValue: z.boolean().optional(),
  })
  .optional()
  .nullable();

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  order: z.number().int().min(0).optional(),
  valueRollup: z.nativeEnum(LeadValueRollup).optional(),
  closurePlaybook: closurePlaybookSchema,
  enableAgentBinding: z.boolean().optional(),
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
    const closurePlaybook =
      parsed.data.closurePlaybook === null
        ? Prisma.JsonNull
        : parsed.data.closurePlaybook
          ? (parseLeadTypeClosurePlaybook(parsed.data.closurePlaybook) as Prisma.InputJsonValue)
          : undefined;
    const row = await prisma.leadType.create({
      data: {
        organizationId,
        name: parsed.data.name.trim(),
        color: parsed.data.color,
        order,
        valueRollup,
        enableAgentBinding: parsed.data.enableAgentBinding ?? false,
        ...(closurePlaybook !== undefined ? { closurePlaybook } : {}),
      },
    });
    if (valueRollup === "WON") {
      await enforceSingleWonType(organizationId, row.id);
    }
    await ensurePipelineStageForLeadType(prisma, organizationId, row.id);
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
    const closurePlaybookPatch =
      parsed.data.closurePlaybook === undefined
        ? undefined
        : parsed.data.closurePlaybook === null
          ? Prisma.JsonNull
          : (parseLeadTypeClosurePlaybook(parsed.data.closurePlaybook) as Prisma.InputJsonValue);
    const row = await prisma.leadType.update({
      where: { id: request.params.id },
      data: {
        name: parsed.data.name.trim(),
        color: parsed.data.color,
        order,
        valueRollup,
        ...(parsed.data.enableAgentBinding !== undefined
          ? { enableAgentBinding: parsed.data.enableAgentBinding }
          : {}),
        ...(closurePlaybookPatch !== undefined ? { closurePlaybook: closurePlaybookPatch } : {}),
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

    const existing = await prisma.leadType.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Lead type not found", statusCode: 404 });
    }

    const pipeline = await getOrCreateDefaultPipeline(prisma, organizationId);
    const stage = await prisma.pipelineStage.findFirst({
      where: { pipelineId: pipeline.id, leadTypeId: request.params.id },
    });
    if (stage) {
      const dealsOnStage = await prisma.deal.count({
        where: { organizationId, stageId: stage.id },
      });
      if (dealsOnStage > 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message:
            "Cannot delete this lead type while deals are still in its pipeline stage. Move or close those deals first.",
          statusCode: 400,
        });
      }
      await prisma.pipelineStage.delete({ where: { id: stage.id } });
    }

    await prisma.leadType.delete({ where: { id: request.params.id } });
    return reply.status(204).send();
  });
}
