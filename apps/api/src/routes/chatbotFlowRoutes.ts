import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  botConfigForVisualFlow,
  defaultChatbotFlowDefinition,
  parseChatbotFlowDefinition,
} from "../lib/chatbotFlowTypes.js";
import { generateChatbotPublicId } from "../lib/chatbotFlowExecutor.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

async function requireChatbotFeature(
  organizationId: string,
  reply: import("fastify").FastifyReply,
): Promise<boolean> {
  const enabled = await isOrganizationFeatureEnabled(organizationId, "chatbot_flow_builder");
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Chatbot flow builder is not enabled for this organization",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

const flowDefinitionSchema = z.object({
  nodes: z.array(z.record(z.unknown())),
  edges: z.array(z.record(z.unknown())),
});

const createFlowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  flowDefinition: flowDefinitionSchema.optional(),
  variables: z.array(z.record(z.unknown())).optional(),
});

const updateFlowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isPublished: z.boolean().optional(),
  flowDefinition: flowDefinitionSchema.optional(),
  variables: z.array(z.record(z.unknown())).optional(),
  theme: z.record(z.unknown()).nullable().optional(),
  settings: z.record(z.unknown()).nullable().optional(),
});

const linkBotSchema = z.object({
  botId: z.string().uuid().nullable(),
});

const testChatSchema = z.object({
  message: z.string().max(4000).default(""),
  contactName: z.string().max(200).optional(),
});

export async function registerChatbotFlowRoutes(app: FastifyInstance): Promise<void> {
  app.get("/chatbot-flows", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const rows = await prisma.chatbotFlow.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      include: {
        linkedBot: { select: { id: true, name: true, isActive: true } },
        _count: { select: { sessions: true } },
      },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        publicId: r.publicId,
        isPublished: r.isPublished,
        flowDefinition: r.flowDefinition,
        variables: r.variables,
        theme: r.theme,
        settings: r.settings,
        linkedBotId: r.linkedBotId,
        linkedBot: r.linkedBot,
        sessionCount: r._count.sessions,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  });

  app.post("/chatbot-flows", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const parsed = createFlowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation", message: parsed.error.message, statusCode: 400 });
    }

    const flowDef = parsed.data.flowDefinition ?? defaultChatbotFlowDefinition();
    const row = await prisma.chatbotFlow.create({
      data: {
        organizationId,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() ?? null,
        publicId: generateChatbotPublicId(),
        flowDefinition: flowDef as Prisma.InputJsonValue,
        variables: (parsed.data.variables ?? []) as Prisma.InputJsonValue,
      },
    });
    return reply.status(201).send(row);
  });

  app.get("/chatbot-flows/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const { id } = request.params as { id: string };
    const row = await prisma.chatbotFlow.findFirst({
      where: { id, organizationId },
      include: { linkedBot: { select: { id: true, name: true, isActive: true, config: true } } },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }
    return row;
  });

  app.patch("/chatbot-flows/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const { id } = request.params as { id: string };
    const parsed = updateFlowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.chatbotFlow.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    const data: Prisma.ChatbotFlowUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.isPublished !== undefined) data.isPublished = parsed.data.isPublished;
    if (parsed.data.flowDefinition !== undefined) {
      data.flowDefinition = parsed.data.flowDefinition as Prisma.InputJsonValue;
    }
    if (parsed.data.variables !== undefined) {
      data.variables = parsed.data.variables as Prisma.InputJsonValue;
    }
    if (parsed.data.theme !== undefined) data.theme = parsed.data.theme as Prisma.InputJsonValue;
    if (parsed.data.settings !== undefined) data.settings = parsed.data.settings as Prisma.InputJsonValue;

    const row = await prisma.chatbotFlow.update({ where: { id }, data });
    return row;
  });

  app.delete("/chatbot-flows/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const { id } = request.params as { id: string };
    const existing = await prisma.chatbotFlow.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    if (existing.linkedBotId) {
      await prisma.bot.update({
        where: { id: existing.linkedBotId },
        data: { config: {} },
      });
    }

    await prisma.chatbotFlow.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/chatbot-flows/:id/link-bot", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const { id } = request.params as { id: string };
    const parsed = linkBotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation", message: parsed.error.message, statusCode: 400 });
    }

    const flow = await prisma.chatbotFlow.findFirst({ where: { id, organizationId } });
    if (!flow) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    if (flow.linkedBotId && flow.linkedBotId !== parsed.data.botId) {
      await prisma.bot.update({
        where: { id: flow.linkedBotId },
        data: { config: {} },
      });
    }

    if (!parsed.data.botId) {
      const updated = await prisma.chatbotFlow.update({
        where: { id },
        data: { linkedBotId: null },
      });
      return updated;
    }

    const bot = await prisma.bot.findFirst({
      where: { id: parsed.data.botId, organizationId },
    });
    if (!bot) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }

    await prisma.chatbotFlow.updateMany({
      where: { organizationId, linkedBotId: bot.id, id: { not: id } },
      data: { linkedBotId: null },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const f = await tx.chatbotFlow.update({
        where: { id },
        data: { linkedBotId: bot.id },
      });
      await tx.bot.update({
        where: { id: bot.id },
        data: {
          webhookUrl: null,
          config: botConfigForVisualFlow(id) as Prisma.InputJsonValue,
          isActive: true,
        },
      });
      if (!f.isPublished) {
        await tx.chatbotFlow.update({ where: { id }, data: { isPublished: true } });
      }
      return { ...f, isPublished: true, linkedBotId: bot.id };
    });

    return updated;
  });

  app.post("/chatbot-flows/:id/test-chat", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    if (!(await requireChatbotFeature(organizationId, reply))) return;

    const { id } = request.params as { id: string };
    const parsed = testChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation", message: parsed.error.message, statusCode: 400 });
    }

    const flow = await prisma.chatbotFlow.findFirst({ where: { id, organizationId } });
    if (!flow) {
      return reply.status(404).send({ error: "Not Found", message: "Flow not found", statusCode: 404 });
    }

    const def = parseChatbotFlowDefinition(flow.flowDefinition);
    if (!def) {
      return reply.status(400).send({ error: "Validation", message: "Invalid flow definition", statusCode: 400 });
    }

    return {
      ok: true,
      message: "Use o simulador na UI ou ligue o fluxo a um bot activo para testar em conversas reais.",
      nodeCount: def.nodes.length,
      edgeCount: def.edges.length,
      publicId: flow.publicId,
    };
  });
}
