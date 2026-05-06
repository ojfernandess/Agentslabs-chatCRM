import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticateAgentBot } from "../middleware/agentBotAuth.js";
import { sendMessageSchema } from "../lib/messagePayload.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";

const patchConversationSchema = z.object({
  status: z.enum(["OPEN", "PENDING"]),
});

/**
 * API HTTP para Agent Bots (estilo Chatwoot): autenticação `Authorization: Bearer ocb_...`.
 * Base: `/api/v1/agent-bot`
 */
export async function agentBotInboxRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticateAgentBot);

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

      return reply.status(201).send({ message, conversationId: conversation.id });
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

  /** Handoff humano (`OPEN`) ou devolver à fila do bot (`PENDING`), como no Chatwoot. */
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
      data: { status: parsed.data.status, updatedAt: new Date() },
    });

    return updated;
  });
}
