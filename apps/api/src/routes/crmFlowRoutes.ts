import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, CrmFlowStatus, CrmFlowType } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  CRM_FLOW_EXPORT_VERSION,
  crmFlowDefinitionSchema,
  defaultCrmFlowDefinition,
  parseCrmFlowDefinition,
} from "../lib/crmFlowTypes.js";
import { executeCrmFlow } from "../lib/crmFlowExecutor.js";
import type { CrmFlowContext } from "../lib/crmFlowContext.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

async function requireCrmFlowsFeature(
  organizationId: string,
  reply: import("fastify").FastifyReply,
): Promise<boolean> {
  const enabled = await isOrganizationFeatureEnabled(organizationId, "crm_flows");
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "CRM flows are not enabled for this organization",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

const createFlowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  flowType: z.nativeEnum(CrmFlowType).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  flowDefinition: crmFlowDefinitionSchema.optional(),
  variables: z.array(z.record(z.unknown())).optional(),
  templateKey: z.string().max(80).optional(),
});

const updateFlowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  flowType: z.nativeEnum(CrmFlowType).optional(),
  status: z.nativeEnum(CrmFlowStatus).optional(),
  isPublished: z.boolean().optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  flowDefinition: crmFlowDefinitionSchema.optional(),
  variables: z.array(z.record(z.unknown())).optional(),
});

const importFlowSchema = z.object({
  version: z.number().int().optional(),
  exportedAt: z.string().optional(),
  flow: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    flowType: z.nativeEnum(CrmFlowType).optional(),
    triggerConfig: z.record(z.unknown()).optional(),
    flowDefinition: crmFlowDefinitionSchema,
    variables: z.array(z.record(z.unknown())).optional(),
  }),
});

function serializeFlow(row: {
  id: string;
  name: string;
  description: string | null;
  flowType: CrmFlowType;
  status: CrmFlowStatus;
  isPublished: boolean;
  flowDefinition: unknown;
  triggerConfig: unknown;
  variables: unknown;
  lastExecutedAt: Date | null;
  executionCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    flowType: row.flowType,
    status: row.status,
    isPublished: row.isPublished,
    flowDefinition: row.flowDefinition,
    triggerConfig: row.triggerConfig,
    variables: row.variables,
    lastExecutedAt: row.lastExecutedAt?.toISOString() ?? null,
    executionCount: row.executionCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}

export async function registerCrmFlowRoutes(app: FastifyInstance): Promise<void> {
  app.get("/crm-flows/dashboard", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [activeFlows, inactiveFlows, todayExecs, monthExecs, failedExecs, avgDuration] =
      await Promise.all([
        prisma.crmFlow.count({ where: { organizationId, status: "ACTIVE" } }),
        prisma.crmFlow.count({
          where: { organizationId, status: { in: ["INACTIVE", "DRAFT"] } },
        }),
        prisma.crmFlowExecution.count({
          where: { organizationId, startedAt: { gte: startOfDay } },
        }),
        prisma.crmFlowExecution.count({
          where: { organizationId, startedAt: { gte: startOfMonth } },
        }),
        prisma.crmFlowExecution.count({
          where: { organizationId, status: "FAILED", startedAt: { gte: startOfMonth } },
        }),
        prisma.crmFlowExecution.aggregate({
          where: { organizationId, durationMs: { not: null }, startedAt: { gte: startOfMonth } },
          _avg: { durationMs: true },
        }),
      ]);

    const successCount = await prisma.crmFlowExecution.count({
      where: { organizationId, status: "SUCCESS", startedAt: { gte: startOfMonth } },
    });
    const totalMonth = monthExecs || 1;
    const successRate = Math.round((successCount / totalMonth) * 100);

    const executionsByDay = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', started_at) AS day, COUNT(*)::bigint AS count
      FROM crm_flow_executions
      WHERE organization_id = ${organizationId}::uuid
        AND started_at >= ${startOfMonth}
      GROUP BY 1
      ORDER BY 1
    `;

    const topFlows = await prisma.crmFlow.findMany({
      where: { organizationId },
      orderBy: { executionCount: "desc" },
      take: 5,
      select: { id: true, name: true, executionCount: true, flowType: true },
    });

    return {
      cards: {
        activeFlows,
        inactiveFlows,
        executionsToday: todayExecs,
        executionsMonth: monthExecs,
        failures: failedExecs,
        successRate,
        avgDurationMs: Math.round(avgDuration._avg.durationMs ?? 0),
      },
      executionsByDay: executionsByDay.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        count: Number(r.count),
      })),
      topFlows,
    };
  });

  app.get("/crm-flows/templates", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const rows = await prisma.crmFlowTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return { data: rows };
  });

  app.get("/crm-flows", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const q = request.query as { name?: string; flowType?: string; status?: string };
    const where: Prisma.CrmFlowWhereInput = { organizationId };
    if (q.name?.trim()) where.name = { contains: q.name.trim(), mode: "insensitive" };
    if (q.flowType) where.flowType = q.flowType as CrmFlowType;
    if (q.status) where.status = q.status as CrmFlowStatus;

    const rows = await prisma.crmFlow.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
    return { data: rows.map(serializeFlow) };
  });

  app.post("/crm-flows", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const parsed = createFlowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    let flowDefinition = parsed.data.flowDefinition ?? defaultCrmFlowDefinition();
    let triggerConfig = parsed.data.triggerConfig ?? { type: "lead_created" };
    let variables = parsed.data.variables ?? [];

    if (parsed.data.templateKey) {
      const tpl = await prisma.crmFlowTemplate.findUnique({
        where: { key: parsed.data.templateKey },
      });
      if (tpl) {
        flowDefinition = parseCrmFlowDefinition(tpl.flowDefinition);
        triggerConfig = (tpl.triggerConfig as Record<string, unknown>) ?? triggerConfig;
        variables = Array.isArray(tpl.variables)
          ? (tpl.variables as Record<string, unknown>[])
          : variables;
      }
    }

    const row = await prisma.crmFlow.create({
      data: {
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        flowType: parsed.data.flowType ?? "CRM",
        flowDefinition: flowDefinition as Prisma.InputJsonValue,
        triggerConfig: triggerConfig as Prisma.InputJsonValue,
        variables: variables as Prisma.InputJsonValue,
        createdByUserId: request.user.id,
      },
    });
    return { data: serializeFlow(row) };
  });

  app.get<{ Params: { id: string } }>("/crm-flows/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const row = await prisma.crmFlow.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }
    return { data: serializeFlow(row) };
  });

  app.patch<{ Params: { id: string } }>("/crm-flows/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const parsed = updateFlowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.crmFlow.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    const p = parsed.data;
    const data: Prisma.CrmFlowUpdateInput = { version: { increment: 1 } };
    if (p.name !== undefined) data.name = p.name;
    if (p.description !== undefined) data.description = p.description;
    if (p.flowType !== undefined) data.flowType = p.flowType;
    if (p.status !== undefined) data.status = p.status;
    if (p.isPublished !== undefined) data.isPublished = p.isPublished;
    if (p.triggerConfig !== undefined) data.triggerConfig = p.triggerConfig as Prisma.InputJsonValue;
    if (p.flowDefinition !== undefined) data.flowDefinition = p.flowDefinition as Prisma.InputJsonValue;
    if (p.variables !== undefined) data.variables = p.variables as Prisma.InputJsonValue;

    const row = await prisma.crmFlow.update({ where: { id: existing.id }, data });
    return { data: serializeFlow(row) };
  });

  app.delete<{ Params: { id: string } }>("/crm-flows/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const existing = await prisma.crmFlow.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }
    await prisma.crmFlow.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/crm-flows/:id/duplicate", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const existing = await prisma.crmFlow.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    const row = await prisma.crmFlow.create({
      data: {
        organizationId,
        name: `${existing.name} (cópia)`,
        description: existing.description,
        flowType: existing.flowType,
        status: "DRAFT",
        isPublished: false,
        flowDefinition: existing.flowDefinition as Prisma.InputJsonValue,
        triggerConfig: existing.triggerConfig as Prisma.InputJsonValue,
        variables: existing.variables as Prisma.InputJsonValue,
        createdByUserId: request.user.id,
      },
    });
    return { data: serializeFlow(row) };
  });

  app.get<{ Params: { id: string } }>("/crm-flows/:id/export", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const row = await prisma.crmFlow.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    return {
      version: CRM_FLOW_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      flow: {
        name: row.name,
        description: row.description,
        flowType: row.flowType,
        triggerConfig: row.triggerConfig,
        flowDefinition: row.flowDefinition,
        variables: row.variables,
      },
    };
  });

  app.post("/crm-flows/import", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const parsed = importFlowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const row = await prisma.crmFlow.create({
      data: {
        organizationId,
        name: parsed.data.flow.name,
        description: parsed.data.flow.description,
        flowType: parsed.data.flow.flowType ?? "CRM",
        flowDefinition: parsed.data.flow.flowDefinition as Prisma.InputJsonValue,
        triggerConfig: (parsed.data.flow.triggerConfig ?? {}) as Prisma.InputJsonValue,
        variables: (parsed.data.flow.variables ?? []) as Prisma.InputJsonValue,
        createdByUserId: request.user.id,
      },
    });
    return { data: serializeFlow(row) };
  });

  app.post<{ Params: { id: string } }>("/crm-flows/:id/test", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const flow = await prisma.crmFlow.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!flow) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const triggerType =
      (flow.triggerConfig as { type?: string } | null)?.type ?? "lead_created";

    const result = await executeCrmFlow({
      flow,
      organizationId,
      triggerType,
      triggerPayload: body,
    });
    return { data: result };
  });

  app.get<{ Params: { id: string } }>("/crm-flows/:id/executions", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

    const rows = await prisma.crmFlowExecution.findMany({
      where: { organizationId, crmFlowId: request.params.id },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { logEntries: { orderBy: { sequence: "asc" } } },
    });
    return { data: rows };
  });

  app.post<{ Params: { id: string; executionId: string } }>(
    "/crm-flows/:id/executions/:executionId/reprocess",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!isTenantAdminLike(request.user)) {
        return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
      }
      if (!(await requireCrmFlowsFeature(organizationId, reply))) return;

      const flow = await prisma.crmFlow.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!flow) {
        return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
      }

      const execution = await prisma.crmFlowExecution.findFirst({
        where: {
          id: request.params.executionId,
          crmFlowId: flow.id,
          organizationId,
        },
      });
      if (!execution) {
        return reply.status(404).send({ error: "Not Found", message: "Execution not found", statusCode: 404 });
      }

      const triggerType =
        execution.triggerType ??
        (flow.triggerConfig as { type?: string } | null)?.type ??
        "lead_created";

      const result = await executeCrmFlow({
        flow,
        organizationId,
        triggerType,
        triggerPayload: (execution.triggerPayload ?? {}) as CrmFlowContext,
      });
      return { data: result };
    },
  );
}
