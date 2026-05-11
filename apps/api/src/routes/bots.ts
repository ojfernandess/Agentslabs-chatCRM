import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authenticateSessionOrBotInboxForBotsRead, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { BotType, Prisma } from "@prisma/client";
import { generateBotInboxTokenParts, hashBotInboxToken } from "../middleware/agentBotAuth.js";
import {
  deliverAgentBotTestWebhook,
  AGENT_BOT_WEBHOOK_TEST_PLACEHOLDER_ID,
} from "../lib/agentBotWebhook.js";

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

function isNativeManagedBotConfig(config: unknown): boolean {
  if (config == null || typeof config !== "object") return false;
  return (config as { automationManagedByOpenConduit?: unknown }).automationManagedByOpenConduit === true;
}

function sanitizeBot<T extends { inboxTokenHash?: string | null; inboxTokenPrefix?: string | null; webhookSecret?: string | null; config?: unknown }>(
  row: T,
): Omit<T, "inboxTokenHash" | "inboxTokenPrefix" | "webhookSecret"> & {
  inboxTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  nativeManagedByOpenConduit: boolean;
} {
  const { inboxTokenHash, inboxTokenPrefix, webhookSecret, ...rest } = row;
  return {
    ...rest,
    inboxTokenConfigured: Boolean(inboxTokenHash),
    webhookSecretConfigured: Boolean(webhookSecret),
    nativeManagedByOpenConduit: isNativeManagedBotConfig(row.config),
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

  /** Teste de conectividade (URL ainda não gravada — ex.: formulário de criação). */
  app.post("/webhook-test", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = z
      .object({
        webhookUrl: z.string().url().max(2048),
        webhookSecret: z.union([z.string().max(512), z.literal(""), z.null()]).optional(),
        probeName: z.string().min(1).max(120).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const sr = parsed.data.webhookSecret;
    const secret =
      sr === "" || sr === null ? null : sr === undefined ? null : sr;

    const result = await deliverAgentBotTestWebhook({
      webhookUrl: parsed.data.webhookUrl,
      webhookSecret: secret,
      organizationId,
      bot: {
        id: AGENT_BOT_WEBHOOK_TEST_PLACEHOLDER_ID,
        name: parsed.data.probeName ?? "Webhook test",
        type: BotType.WEBHOOK,
      },
      log: app.log,
    });
    return reply.status(200).send(result);
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

  /** POST opcional: `{ "webhookUrl"?: string, "webhookSecret"?: string | null }` — omite URL para usar a gravada no bot. */
  app.post<{ Params: { id: string } }>("/:id/test-webhook", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const bot = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!bot) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    const parsed = z
      .object({
        webhookUrl: z.string().url().max(2048).optional(),
        webhookSecret: z.union([z.string().max(512), z.literal(""), z.null()]).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const url = (parsed.data.webhookUrl?.trim() || bot.webhookUrl?.trim() || "").trim();
    if (!url) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Set a webhook URL on the bot or include webhookUrl in the body.",
        statusCode: 400,
      });
    }

    let secret: string | null;
    if (parsed.data.webhookSecret !== undefined) {
      const ws = parsed.data.webhookSecret;
      secret = ws === "" || ws === null ? null : ws;
    } else {
      secret = bot.webhookSecret;
    }

    const result = await deliverAgentBotTestWebhook({
      webhookUrl: url,
      webhookSecret: secret,
      organizationId,
      bot: { id: bot.id, name: bot.name, type: bot.type },
      log: app.log,
    });
    return reply.status(200).send(result);
  });

  app.post<{ Params: { id: string } }>("/:id/native-diagnostic", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const bot = await prisma.bot.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!bot) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }

    const nativeManagedByOpenConduit = isNativeManagedBotConfig(bot.config);
    const hasWebhookUrl = Boolean(bot.webhookUrl?.trim());
    const hasInboxToken = Boolean(bot.inboxTokenHash);
    const linkedInSettings =
      (await prisma.settings.count({ where: { organizationId, agentBotId: bot.id } })) > 0;
    const linkedInInbox =
      (await prisma.inbox.count({ where: { organizationId, agentBotId: bot.id } })) > 0;
    const profile = await prisma.automationAgentProfile.findFirst({
      where: { organizationId, botId: bot.id },
      select: { id: true, llmConfig: true },
    });
    const llmCfg =
      profile?.llmConfig && typeof profile.llmConfig === "object"
        ? (profile.llmConfig as Record<string, unknown>)
        : null;
    const hasApiKeyConfigured = typeof llmCfg?.apiKey === "string" && llmCfg.apiKey.trim() !== "" && llmCfg.apiKey !== "***";
    const checks = {
      botActive: bot.isActive,
      nativeManagedByOpenConduit,
      linkedInSettings,
      linkedInInbox,
      hasAutomationProfile: Boolean(profile),
      hasApiKeyConfigured,
      hasWebhookUrl,
      hasInboxToken,
    };

    const reasons: string[] = [];
    if (!checks.botActive) reasons.push("Bot está inativo.");
    if (!checks.nativeManagedByOpenConduit) reasons.push("Bot não está marcado como nativo (automationManagedByOpenConduit).");
    if (!checks.linkedInSettings && !checks.linkedInInbox) reasons.push("Bot não está vinculado em Configurações nem em nenhuma Inbox.");
    if (!checks.hasAutomationProfile) reasons.push("Perfil do agente IA não encontrado para este bot.");
    if (checks.hasAutomationProfile && !checks.hasApiKeyConfigured) reasons.push("Chave de API do agente não configurada no perfil IA.");

    let status: "ok" | "warn" | "error" = "ok";
    if (reasons.length > 0) status = "error";
    else if (checks.hasWebhookUrl) status = "warn";

    const summary =
      status === "ok"
        ? "Diagnóstico OK: bot nativo pronto para responder."
        : status === "warn"
          ? "Diagnóstico parcial: bot apto, mas há webhook externo configurado."
          : "Diagnóstico com falhas: ajustes necessários.";

    return {
      botId: bot.id,
      status,
      summary,
      checks,
      reasons,
      hints: [
        "Confirme se a mensagem inbound entrou na conversa com status PENDING e sem atendente.",
        "Use Testar chat do agente em Automação para validar geração LLM.",
      ],
    };
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
