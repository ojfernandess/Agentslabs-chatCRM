import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authenticateSessionOrBotInboxForBotsRead, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { BotType, Prisma } from "@prisma/client";
import { generateBotInboxTokenParts, hashBotInboxToken } from "../middleware/agentBotAuth.js";

const createBotSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
  type: z.nativeEnum(BotType).optional(),
  webhookUrl: z.string().url().max(2048).optional(),
  webhookSecret: z.union([z.string().max(512), z.literal(""), z.null()]).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const patchBotSchema = createBotSchema.partial();

function sanitizeBot<T extends { inboxTokenHash?: string | null; inboxTokenPrefix?: string | null; webhookSecret?: string | null }>(
  row: T,
): Omit<T, "inboxTokenHash" | "inboxTokenPrefix" | "webhookSecret"> & {
  inboxTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
} {
  const { inboxTokenHash, inboxTokenPrefix, webhookSecret, ...rest } = row;
  return {
    ...rest,
    inboxTokenConfigured: Boolean(inboxTokenHash),
    webhookSecretConfigured: Boolean(webhookSecret),
  };
}

const logInteractionSchema = z.object({
  direction: z.string().min(1).max(32),
  payload: z.record(z.unknown()),
  conversationId: z.string().uuid().optional(),
});

export async function botRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticateSessionOrBotInboxForBotsRead] }, async (request, reply) => {
    if (request.agentBot) {
      const row = await prisma.bot.findFirst({
        where: { id: request.agentBot.id, organizationId: request.agentBot.organizationId },
        include: { _count: { select: { interactions: true } } },
      });
      if (!row) {
        return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
      }
      return { data: [sanitizeBot(row)] };
    }

    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (request.user.role === "AGENT") {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const rows = await prisma.bot.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { interactions: true } } },
    });
    return { data: rows.map((b) => sanitizeBot(b)) };
  });

  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = createBotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const row = await prisma.bot.create({
      data: {
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        avatarUrl: parsed.data.avatarUrl,
        type: parsed.data.type ?? "WEBHOOK",
        webhookUrl: parsed.data.webhookUrl,
        webhookSecret:
          parsed.data.webhookSecret === "" || parsed.data.webhookSecret === null
            ? null
            : parsed.data.webhookSecret,
        config: parsed.data.config as Prisma.InputJsonValue | undefined,
        isActive: parsed.data.isActive ?? false,
      },
    });
    return reply.status(201).send(sanitizeBot(row));
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler: [authenticateSessionOrBotInboxForBotsRead] }, async (request, reply) => {
    if (request.agentBot) {
      if (request.params.id !== request.agentBot.id) {
        return reply.status(403).send({
          error: "Forbidden",
          statusCode: 403,
          message: "Agent bot token can only access GET /api/v1/bots/<own-bot-id>.",
          messagePt:
            "Com o token ocb_ só pode consultar o próprio bot: GET /api/v1/bots/<id-deste-bot> (o id deve coincidir com o do token).",
        });
      }
      const row = await prisma.bot.findFirst({
        where: { id: request.agentBot.id, organizationId: request.agentBot.organizationId },
        include: { _count: { select: { interactions: true } } },
      });
      if (!row) {
        return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
      }
      return sanitizeBot(row);
    }

    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (request.user.role === "AGENT") {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const row = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
      include: { _count: { select: { interactions: true } } },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    return sanitizeBot(row);
  });

  app.patch<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = patchBotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    const data: Prisma.BotUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl;
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.webhookUrl !== undefined) data.webhookUrl = parsed.data.webhookUrl;
    if (parsed.data.webhookSecret !== undefined) {
      data.webhookSecret =
        parsed.data.webhookSecret === "" || parsed.data.webhookSecret === null ? null : parsed.data.webhookSecret;
    }
    if (parsed.data.config !== undefined) data.config = parsed.data.config as object;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    const updated = await prisma.bot.update({ where: { id: existing.id }, data });
    return sanitizeBot(updated);
  });

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const res = await prisma.bot.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/inbox-token", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const existing = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    const { token, prefix } = generateBotInboxTokenParts();
    const inboxTokenHash = await hashBotInboxToken(token);
    await prisma.bot.update({
      where: { id: existing.id },
      data: { inboxTokenPrefix: prefix, inboxTokenHash },
    });
    return { inboxAccessToken: token };
  });

  app.get<{ Params: { id: string } }>("/:id/interactions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const bot = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!bot) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    const rows = await prisma.botInteraction.findMany({
      where: { botId: bot.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { data: rows };
  });

  app.post<{ Params: { id: string } }>("/:id/interactions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = logInteractionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const bot = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!bot) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    if (parsed.data.conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: parsed.data.conversationId, organizationId },
      });
      if (!conv) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid conversation", statusCode: 400 });
      }
    }
    const row = await prisma.botInteraction.create({
      data: {
        botId: bot.id,
        direction: parsed.data.direction,
        payload: parsed.data.payload as Prisma.InputJsonValue,
        conversationId: parsed.data.conversationId,
      },
    });
    return reply.status(201).send(row);
  });
}
