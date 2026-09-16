import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { resolveWebchatSessionByToken } from "../lib/webchatSession.js";
import { dispatchAgentBotWebhook } from "../lib/agentBotWebhook.js";
import { getAgentBotDispatchContextForInbox } from "../lib/agentBotTriage.js";
import { broadcastConversationUpdated } from "../lib/workspaceHub.js";

/**
 * Web Chat externo — rotas públicas por token seguro (`/s/:token` no frontend).
 *
 * Segurança:
 * - token aleatório não enumerável, expirável e revogável (webchat_sessions);
 * - a URL nunca expõe organization_id / conversation_id / contact_id;
 * - um token acede exclusivamente à conversa vinculada (isolamento multi-tenant);
 * - rate limiting em memória contra brute force / enumeração;
 * - conteúdo tratado como texto puro (o frontend nunca renderiza HTML do cliente).
 */

const MAX_BODY_CHARS = 8000;
const LIST_LIMIT = 200;

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    if (rateBuckets.size > 20_000) {
      for (const [k, b] of rateBuckets) {
        if (b.resetAt <= now) rateBuckets.delete(k);
      }
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

function clientIp(request: FastifyRequest): string {
  return request.ip ?? "unknown";
}

const sendMessageSchema = z.object({
  content: z.string().min(1).max(MAX_BODY_CHARS),
});

const listQuerySchema = z.object({
  /** ISO timestamp — devolve apenas mensagens criadas depois (polling incremental). */
  since: z.string().datetime({ offset: true }).optional(),
});

function sessionError(reply: FastifyReply, code: "NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_REVOKED") {
  const status = code === "NOT_FOUND" ? 404 : 410;
  return reply.status(status).send({ error: code, statusCode: status });
}

type PublicWebchatMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  channel: string | null;
  status: string;
  createdAt: string;
};

function toPublicMessage(m: {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  channel: string | null;
  status: string;
  createdAt: Date;
}): PublicWebchatMessage {
  return {
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    mediaUrl: m.mediaUrl,
    mediaType: m.mediaType,
    channel: m.channel,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function webchatPublicRoutes(app: FastifyInstance): Promise<void> {
  /** Bootstrap da sessão: branding + estado. Não expõe IDs internos. */
  app.get<{ Params: { token: string } }>("/:token/session", async (request, reply) => {
    if (rateLimited(`ip:${clientIp(request)}`, 120, 60_000)) {
      return reply.status(429).send({ error: "Too Many Requests", statusCode: 429 });
    }
    const resolved = await resolveWebchatSessionByToken(request.params.token);
    if (!resolved.ok) return sessionError(reply, resolved.code);

    const conv = await prisma.conversation.findFirst({
      where: { id: resolved.conversation.id },
      select: { awaitingHumanHandoff: true, assignedToId: true, status: true },
    });

    return {
      ok: true,
      organizationName: resolved.organizationName,
      agentName: resolved.agentBotName,
      expiresAt: resolved.session.expiresAt.toISOString(),
      humanActive: Boolean(conv?.awaitingHumanHandoff || conv?.assignedToId),
      conversationStatus: conv?.status ?? "OPEN",
    };
  });

  /** Lista mensagens públicas da MESMA conversa (histórico WhatsApp + Web Chat + humano). */
  app.get<{ Params: { token: string }; Querystring: { since?: string } }>(
    "/:token/messages",
    async (request, reply) => {
      if (rateLimited(`msgs:${request.params.token}`, 90, 60_000)) {
        return reply.status(429).send({ error: "Too Many Requests", statusCode: 429 });
      }
      const resolved = await resolveWebchatSessionByToken(request.params.token);
      if (!resolved.ok) return sessionError(reply, resolved.code);

      const q = listQuerySchema.safeParse(request.query ?? {});
      const since = q.success && q.data.since ? new Date(q.data.since) : null;

      const rows = await prisma.message.findMany({
        where: {
          conversationId: resolved.conversation.id,
          isPrivate: false,
          ...(since ? { createdAt: { gt: since } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: LIST_LIMIT,
        select: {
          id: true,
          direction: true,
          type: true,
          body: true,
          mediaUrl: true,
          mediaType: true,
          channel: true,
          status: true,
          createdAt: true,
        },
      });

      const conv = await prisma.conversation.findFirst({
        where: { id: resolved.conversation.id },
        select: { awaitingHumanHandoff: true, assignedToId: true },
      });

      return {
        ok: true,
        messages: rows.map(toPublicMessage),
        humanActive: Boolean(conv?.awaitingHumanHandoff || conv?.assignedToId),
      };
    },
  );

  /**
   * Cliente envia mensagem pelo Web Chat → mensagem INBOUND na MESMA conversa
   * (channel = WEBCHAT) → mesmo Agent Runtime / mesmo Interaction Budget.
   */
  app.post<{ Params: { token: string } }>("/:token/messages", async (request, reply) => {
    if (
      rateLimited(`send:${request.params.token}`, 30, 60_000) ||
      rateLimited(`ip:${clientIp(request)}`, 120, 60_000)
    ) {
      return reply.status(429).send({ error: "Too Many Requests", statusCode: 429 });
    }
    const parsed = sendMessageSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const resolved = await resolveWebchatSessionByToken(request.params.token);
    if (!resolved.ok) return sessionError(reply, resolved.code);

    const { organizationId } = resolved.conversation;
    const conversation = await prisma.conversation.findFirst({
      where: { id: resolved.conversation.id, organizationId },
    });
    if (!conversation) return sessionError(reply, "NOT_FOUND");

    const contact = await prisma.contact.findFirst({
      where: { id: resolved.conversation.contactId, organizationId },
    });
    if (!contact) return sessionError(reply, "NOT_FOUND");
    if (contact.isBlocked) {
      return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body: parsed.data.content.trim().slice(0, MAX_BODY_CHARS),
        channel: "WEBCHAT",
        status: "DELIVERED",
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    broadcastConversationUpdated(organizationId, conversation.id);

    /** Mesmo Agent Runtime — o canal não altera as capacidades do agente. */
    const agentCtx = await getAgentBotDispatchContextForInbox(organizationId, conversation.inboxId);
    if (agentCtx) {
      const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id } });
      if (fresh) {
        void dispatchAgentBotWebhook({
          organizationId,
          settings: { agentBotId: agentCtx.agentBotId, agentBot: agentCtx.agentBot },
          conversation: fresh,
          contact,
          message,
          log: request.log,
        });
      }
    }

    return { ok: true, message: toPublicMessage(message) };
  });
}
