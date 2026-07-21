import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AutomationLogLevel, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { flushAutomationLogBuffer } from "../lib/automationExecutionLog.js";
import { resolveAutomationToolIdFromLogNode } from "../lib/automationHttpToolExecute.js";
import {
  analyzeExecutionQualityFromLogs,
  buildExecutionFlowGraph,
} from "../lib/automationExecutionQuality.js";
import { generateNativeAgentReply } from "../lib/agentNativeLlm.js";
import { deliverAgentReplyMessage } from "../lib/agentVoiceReply.js";
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

async function enrichExecutionLogEntries(
  organizationId: string,
  logEntries: Array<{ nodeId: string; nodeName: string }>,
) {
  const toolIds = new Set<string>();
  for (const entry of logEntries) {
    const toolId = resolveAutomationToolIdFromLogNode(entry.nodeId, entry.nodeName);
    if (toolId) toolIds.add(toolId);
  }
  if (toolIds.size === 0) {
    return logEntries.map((entry) => ({
      ...entry,
      automationToolId: null as string | null,
      automationToolName: null as string | null,
    }));
  }
  const toolRows = await prisma.automationCustomTool.findMany({
    where: { organizationId, id: { in: [...toolIds] } },
    select: { id: true, name: true },
  });
  const toolNameById = new Map(toolRows.map((row) => [row.id, row.name]));
  return logEntries.map((entry) => {
    const automationToolId = resolveAutomationToolIdFromLogNode(entry.nodeId, entry.nodeName);
    const automationToolName = automationToolId ? (toolNameById.get(automationToolId) ?? null) : null;
    return { ...entry, automationToolId, automationToolName };
  });
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
    const logEntries = await enrichExecutionLogEntries(organizationId, exec.logEntries);
    const qualitySignals = analyzeExecutionQualityFromLogs(exec.logEntries);
    const flowGraph = buildExecutionFlowGraph(exec.logEntries);
    return { ...exec, logEntries, qualitySignals, flowGraph };
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

  const actionBodySchema = z.object({
    action: z.enum(["send_now", "ignore", "retry"]),
    replyText: z.string().max(8000).optional(),
  });

  app.post<{ Params: { id: string } }>(
    "/execution-logs/:id/quality-action",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!isTenantAdminLike(request.user)) {
        return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
      }
      const parsed = actionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const id = request.params.id;
      await flushAutomationLogBuffer().catch(() => {});
      const exec = await prisma.automationExecution.findFirst({
        where: { id, organizationId },
        include: {
          logEntries: { orderBy: { sequence: "asc" } },
          bot: { select: { id: true, name: true } },
        },
      });
      if (!exec) {
        return reply.status(404).send({ error: "Not Found", message: "Execution not found", statusCode: 404 });
      }

      if (parsed.data.action === "ignore") {
        return { ok: true, action: "ignore" };
      }

      if (!exec.conversationId) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Execution has no conversationId",
          statusCode: 400,
        });
      }

      const conversation = await prisma.conversation.findFirst({
        where: { id: exec.conversationId, organizationId },
        include: { contact: true },
      });
      if (!conversation?.contact) {
        return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
      }

      let triggerMessage =
        exec.triggerMessageId != null
          ? await prisma.message.findFirst({
              where: { id: exec.triggerMessageId, conversationId: conversation.id },
            })
          : null;
      if (!triggerMessage) {
        triggerMessage = await prisma.message.findFirst({
          where: { conversationId: conversation.id, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
        });
      }
      if (!triggerMessage) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "No inbound message to retry",
          statusCode: 400,
        });
      }

      const profile = await prisma.automationAgentProfile.findUnique({
        where: { botId: exec.botId },
        select: { behaviorConfig: true },
      });

      const bot = await prisma.bot.findFirst({
        where: { id: exec.botId, organizationId },
      });
      if (!bot) {
        return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
      }

      if (parsed.data.action === "retry") {
        const replyText = await generateNativeAgentReply({
          organizationId,
          bot,
          conversation,
          message: triggerMessage,
          log: request.log,
          contactId: conversation.contact.id,
        });
        if (!replyText.trim()) {
          return reply.status(422).send({
            error: "Unprocessable Entity",
            message: "Agent returned empty reply",
            statusCode: 422,
          });
        }
        await deliverAgentReplyMessage({
          organizationId,
          botId: exec.botId,
          conversation,
          contact: conversation.contact,
          inboundMessage: triggerMessage,
          replyText,
          behaviorConfig: profile?.behaviorConfig,
          log: request.log,
        });
        return { ok: true, action: "retry", replyChars: replyText.length };
      }

      let replyText = parsed.data.replyText?.trim() ?? "";
      if (!replyText) {
        for (let i = exec.logEntries.length - 1; i >= 0; i -= 1) {
          const e = exec.logEntries[i];
          if (e.nodeId !== "quality" || !e.outputContext || typeof e.outputContext !== "object") continue;
          const o = e.outputContext as Record<string, unknown>;
          const rp = o.replyPreview;
          if (typeof rp === "string" && rp.trim()) {
            replyText = rp.trim();
            break;
          }
        }
      }
      if (!replyText) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "No reply text available to send",
          statusCode: 400,
        });
      }

      await deliverAgentReplyMessage({
        organizationId,
        botId: exec.botId,
        conversation,
        contact: conversation.contact,
        inboundMessage: triggerMessage,
        replyText,
        behaviorConfig: profile?.behaviorConfig,
        log: request.log,
      });
      return { ok: true, action: "send_now", replyChars: replyText.length };
    },
  );
}
