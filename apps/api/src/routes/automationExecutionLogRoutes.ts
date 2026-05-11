import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AutomationLogLevel, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { flushAutomationLogBuffer } from "../lib/automationExecutionLog.js";
import { requireAdmin } from "../middleware/auth.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

const levelEnum = z.enum(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);

const listQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  workflowKey: z.string().max(120).optional(),
  level: levelEnum.optional(),
  executionId: z.string().uuid().optional(),
  botId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).max(10_000).optional().default(0),
});

const settingsPatchSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
  minPersistLevel: levelEnum.optional(),
  alertWebhookUrl: z.union([z.string().url().max(2048), z.literal(""), z.null()]).optional(),
  alertEmail: z.union([z.string().email().max(255), z.literal(""), z.null()]).optional(),
  alertMinLevel: levelEnum.optional(),
});

function csvEscape(s: string): string {
  const t = s.replace(/"/g, '""');
  if (/[",\n\r]/.test(t)) return `"${t}"`;
  return t;
}

export async function registerAutomationExecutionLogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/execution-logs/settings", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const row = await prisma.automationExecutionLogSettings.findUnique({
      where: { organizationId },
    });
    return (
      row ?? {
        organizationId,
        retentionDays: 30,
        minPersistLevel: "DEBUG" as AutomationLogLevel,
        alertWebhookUrl: null,
        alertEmail: null,
        alertMinLevel: "ERROR" as AutomationLogLevel,
        updatedAt: new Date().toISOString(),
      }
    );
  });

  app.patch("/execution-logs/settings", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const parsed = settingsPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.retentionDays !== undefined) data.retentionDays = d.retentionDays;
    if (d.minPersistLevel !== undefined) data.minPersistLevel = d.minPersistLevel;
    if (d.alertMinLevel !== undefined) data.alertMinLevel = d.alertMinLevel;
    if (d.alertWebhookUrl !== undefined) {
      data.alertWebhookUrl = d.alertWebhookUrl === "" || d.alertWebhookUrl === null ? null : d.alertWebhookUrl;
    }
    if (d.alertEmail !== undefined) {
      data.alertEmail = d.alertEmail === "" || d.alertEmail === null ? null : d.alertEmail;
    }
    if (Object.keys(data).length === 0) {
      const existing = await prisma.automationExecutionLogSettings.findUnique({ where: { organizationId } });
      return (
        existing ?? {
          organizationId,
          retentionDays: 30,
          minPersistLevel: "DEBUG" as AutomationLogLevel,
          alertWebhookUrl: null,
          alertEmail: null,
          alertMinLevel: "ERROR" as AutomationLogLevel,
          updatedAt: new Date(),
        }
      );
    }
    const row = await prisma.automationExecutionLogSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        retentionDays: (d.retentionDays ?? 30) as number,
        minPersistLevel: (d.minPersistLevel ?? "DEBUG") as AutomationLogLevel,
        alertWebhookUrl:
          d.alertWebhookUrl === "" || d.alertWebhookUrl === null || d.alertWebhookUrl === undefined
            ? null
            : d.alertWebhookUrl,
        alertEmail:
          d.alertEmail === "" || d.alertEmail === null || d.alertEmail === undefined ? null : d.alertEmail,
        alertMinLevel: (d.alertMinLevel ?? "ERROR") as AutomationLogLevel,
      },
      update: data,
    });
    return row;
  });

  app.get("/execution-logs", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const q = listQuerySchema.safeParse(request.query ?? {});
    if (!q.success) {
      return reply.status(400).send({ error: "Bad Request", message: q.error.message, statusCode: 400 });
    }
    const { from, to, workflowKey, level, executionId, botId, limit, offset } = q.data;
    const where: Prisma.AutomationExecutionWhereInput = { organizationId };
    if (executionId) where.id = executionId;
    if (botId) where.botId = botId;
    if (workflowKey) where.workflowKey = workflowKey;
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }
    if (level) {
      where.logEntries = { some: { level } };
    }
    const rows = await prisma.automationExecution.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        botId: true,
        conversationId: true,
        triggerMessageId: true,
        workflowKey: true,
        workflowName: true,
        status: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        bot: { select: { name: true } },
      },
    });
    const nextOffset = offset + rows.length;
    return { data: rows, nextOffset, hasMore: rows.length === limit };
  });

  app.get<{ Params: { id: string } }>("/execution-logs/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const id = request.params.id;
    const exec = await prisma.automationExecution.findFirst({
      where: { id, organizationId },
      include: {
        bot: { select: { id: true, name: true } },
        logEntries: { orderBy: { sequence: "asc" } },
      },
    });
    if (!exec) {
      return reply.status(404).send({ error: "Not Found", message: "Execution not found", statusCode: 404 });
    }
    return exec;
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    "/execution-logs/:id/export",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!isTenantAdminLike(request.user)) {
        return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
      }
      const id = request.params.id;
      const format = (request.query.format ?? "json").toLowerCase();
      const exec = await prisma.automationExecution.findFirst({
        where: { id, organizationId },
        include: { logEntries: { orderBy: { sequence: "asc" } }, bot: { select: { name: true } } },
      });
      if (!exec) {
        return reply.status(404).send({ error: "Not Found", message: "Execution not found", statusCode: 404 });
      }
      await flushAutomationLogBuffer().catch(() => {});
      const reloaded = await prisma.automationExecution.findFirst({
        where: { id, organizationId },
        include: { logEntries: { orderBy: { sequence: "asc" } }, bot: { select: { name: true } } },
      });
      if (!reloaded) {
        return reply.status(404).send({ error: "Not Found", message: "Execution not found", statusCode: 404 });
      }
      if (format === "csv") {
        const header = ["sequence", "level", "nodePath", "nodeId", "nodeName", "message", "createdAt"].join(",");
        const lines = reloaded.logEntries.map((e) =>
          [
            e.sequence,
            e.level,
            csvEscape(e.nodePath),
            csvEscape(e.nodeId),
            csvEscape(e.nodeName),
            csvEscape(e.message),
            e.createdAt.toISOString(),
          ].join(","),
        );
        const body = [header, ...lines].join("\n");
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="execution-${id}.csv"`);
        return reply.send(body);
      }
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="execution-${id}.json"`);
      return reply.send(JSON.stringify(reloaded, null, 2));
    },
  );
}
