import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticateAgentBot } from "../middleware/agentBotAuth.js";
import { sendMessageSchema } from "../lib/messagePayload.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";
import {
  assignConversationTeamBodySchema,
  assignConversationTeamForOrg,
} from "../lib/conversationTeamAssignment.js";

const patchConversationSchema = z.object({
  status: z.enum(["OPEN", "PENDING"]),
});

/**
 * API HTTP para Agent Bots: autenticação `Authorization: Bearer ocb_...`.
 * Base: `/api/v1/agent-bot`
 */
export async function agentBotInboxRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticateAgentBot);

  /**
   * Identidade do bot com o mesmo Bearer `ocb_...` usado nas outras rotas do agent-bot
   * (equivalente a validar o “access token” do bot noutras plataformas — não usar em /api/v1/bots).
   */
  app.get("/profile", async (request, reply) => {
    const agent = request.agentBot!;
    const row = await prisma.bot.findFirst({
      where: { id: agent.id, organizationId: agent.organizationId },
      include: { _count: { select: { interactions: true } } },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Bot not found", statusCode: 404 });
    }
    const { inboxTokenHash, inboxTokenPrefix, webhookSecret, ...rest } = row;
    return {
      ...rest,
      inboxTokenConfigured: Boolean(inboxTokenHash),
      webhookSecretConfigured: Boolean(webhookSecret),
      agent_bot_id: row.id,
    };
  });

  /** Colunas do funil (tipos de lead / estágios), sem listar contactos do board. */
  app.get("/lead-types", async (request) => {
    const bot = request.agentBot!;
    const rows = await prisma.leadType.findMany({
      where: { organizationId: bot.organizationId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, color: true, order: true, valueRollup: true },
    });
    return { data: rows };
  });

  /** Equipas da organização (roteamento a partir do fluxo do bot). */
  app.get("/teams", async (request) => {
    const bot = request.agentBot!;
    const teams = await prisma.team.findMany({
      where: { organizationId: bot.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, _count: { select: { members: true } } },
    });
    return { data: teams };
  });

  /** Envia mensagem outbound ao contacto (eco no WhatsApp). */
  app.post("/messages", async (request, reply) => {
    const bot = request.agentBot!;
    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.status(400).send({ error: "Bad Request", message: first?.message ?? parsed.error.message, statusCode: 400 });
    }

    if (parsed.data.isPrivate) {
      return reply.status(403).send({ error: "Forbidden", message: "Private notes not allowed for agent bot", statusCode: 403 });
    }

    try {
      const settings = await prisma.settings.findUnique({
        where: { organizationId: bot.organizationId },
        select: { agentBotId: true },
      });
      const botTriageActive =
        settings?.agentBotId === bot.id &&
        (await prisma.bot.findFirst({
          where: { id: bot.id, organizationId: bot.organizationId, isActive: true, webhookUrl: { not: null } },
          select: { id: true },
        })) != null;

      const { message, conversation } = await deliverOutboundWhatsAppMessage({
        organizationId: bot.organizationId,
        data: parsed.data,
        actor: { kind: "agent_bot", botId: bot.id },
        log: app.log,
        newConversation: {
          status: botTriageActive ? "PENDING" : "OPEN",
          assignedToId: null,
        },
      });

      return reply.status(201).send({
        message,
        conversationId: conversation.id,
        agent_bot_id: bot.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (msg.includes("not found") || msg.includes("Contact")) {
        return reply.status(404).send({ error: "Not Found", message: msg, statusCode: 404 });
      }
      if (msg.includes("24-hour") || msg.includes("session")) {
        return reply.status(422).send({ error: "Unprocessable Entity", message: msg, statusCode: 422 });
      }
      app.log.error(err, "agent-bot message failed");
      return reply.status(500).send({ error: "Internal Server Error", message: msg, statusCode: 500 });
    }
  });

  /** Atribuir equipa (e opcionalmente agente) à conversa; mesmo corpo que PATCH /api/v1/automations/conversations/:id/team. */
  app.patch<{ Params: { id: string } }>("/conversations/:id/team", async (request, reply) => {
    const bot = request.agentBot!;
    const parsed = assignConversationTeamBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const result = await assignConversationTeamForOrg(prisma, {
      organizationId: bot.organizationId,
      conversationId: request.params.id,
      body: parsed.data,
    });
    if (!result.ok) {
      return reply.status(result.error.status).send({
        error: result.error.status === 404 ? "Not Found" : "Bad Request",
        message: result.error.message,
        statusCode: result.error.status,
      });
    }
    return result.payload;
  });

  /** Handoff humano (`OPEN`) ou devolver à fila do bot (`PENDING`). */
  app.patch<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const bot = request.agentBot!;
    const parsed = patchConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId: bot.organizationId },
    });
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.status === "PENDING" ? { awaitingHumanHandoff: false } : {}),
        updatedAt: new Date(),
      },
    });

    return updated;
  });
}
