import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MessageType } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveWebchatSessionByToken } from "../lib/webchatSession.js";
import { dispatchAgentBotWebhook } from "../lib/agentBotWebhook.js";
import { getAgentBotDispatchContextForInbox } from "../lib/agentBotTriage.js";
import { broadcastConversationUpdated } from "../lib/workspaceHub.js";
import {
  allowAudioVoiceUpload,
  allowRichMediaUpload,
  messageTypeFromMime,
  persistMultipartMedia,
} from "../lib/messageMediaUpload.js";

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

const sendMessageSchema = z
  .object({
    content: z.string().max(MAX_BODY_CHARS).optional(),
    mediaUrl: z.string().url().max(2048).optional(),
    mediaType: z.string().max(128).optional(),
    type: z.enum(["TEXT", "IMAGE", "AUDIO", "DOCUMENT", "VIDEO"]).optional(),
  })
  .refine((d) => Boolean(d.content?.trim()) || Boolean(d.mediaUrl), {
    message: "content or mediaUrl required",
  });

const listQuerySchema = z.object({
  /** ISO timestamp — devolve apenas mensagens criadas depois (polling incremental). */
  since: z.string().datetime({ offset: true }).optional(),
});

function sessionError(
  reply: FastifyReply,
  code: "NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "SESSION_CLAIMED" | "CLIENT_SESSION_REQUIRED",
) {
  const status =
    code === "NOT_FOUND" ? 404 : code === "SESSION_CLAIMED" || code === "CLIENT_SESSION_REQUIRED" ? 403 : 410;
  return reply.status(status).send({ error: code, statusCode: status });
}

function readClientSessionSecret(request: FastifyRequest): string | null {
  const raw = request.headers["x-webchat-client-session"];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].trim()) return raw[0].trim();
  return null;
}

async function resolvePublicWebchatSession(request: FastifyRequest, token: string) {
  return resolveWebchatSessionByToken(token, readClientSessionSecret(request));
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

async function dispatchWebchatInbound(params: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  inboxId: string;
  message: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    type: string;
    body: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    channel: string | null;
    status: string;
    createdAt: Date;
  };
  log: FastifyRequest["log"];
}): Promise<void> {
  broadcastConversationUpdated(params.organizationId, params.conversationId);
  const agentCtx = await getAgentBotDispatchContextForInbox(params.organizationId, params.inboxId);
  if (!agentCtx) return;
  const fresh = await prisma.conversation.findFirst({ where: { id: params.conversationId } });
  const contact = await prisma.contact.findFirst({
    where: { id: params.contactId, organizationId: params.organizationId },
  });
  if (!fresh || !contact) return;
  void dispatchAgentBotWebhook({
    organizationId: params.organizationId,
    settings: { agentBotId: agentCtx.agentBotId, agentBot: agentCtx.agentBot },
    conversation: fresh,
    contact,
    message: params.message as Parameters<typeof dispatchAgentBotWebhook>[0]["message"],
    log: params.log,
  });
}

function resolveInboundMessageType(input: {
  type?: MessageType;
  mediaUrl?: string | null;
  mediaType?: string | null;
}): MessageType {
  if (input.type) return input.type;
  if (input.mediaUrl && input.mediaType) return messageTypeFromMime(input.mediaType);
  return "TEXT";
}

async function loadWebchatPresence(conversationId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId },
    select: {
      awaitingHumanHandoff: true,
      assignedToId: true,
      status: true,
      assignedTo: { select: { name: true, displayName: true } },
    },
  });
  const assigneeName = conv?.assignedToId
    ? conv.assignedTo?.displayName?.trim() || conv.assignedTo?.name?.trim() || null
    : null;
  return {
    humanActive: Boolean(conv?.awaitingHumanHandoff || conv?.assignedToId),
    assigneeName,
    conversationStatus: conv?.status ?? "OPEN",
  };
}

export async function webchatPublicRoutes(app: FastifyInstance): Promise<void> {
  /** Bootstrap da sessão: branding + estado. Não expõe IDs internos. */
  app.get<{ Params: { token: string } }>("/:token/session", async (request, reply) => {
    if (rateLimited(`ip:${clientIp(request)}`, 120, 60_000)) {
      return reply.status(429).send({ error: "Too Many Requests", statusCode: 429 });
    }
    const resolved = await resolvePublicWebchatSession(request, request.params.token);
    if (!resolved.ok) return sessionError(reply, resolved.code);

    const presence = await loadWebchatPresence(resolved.conversation.id);

    return {
      ok: true,
      organizationName: resolved.organizationName,
      organizationLogoUrl: resolved.organizationLogoUrl,
      agentName: resolved.agentBotName,
      expiresAt: resolved.session.expiresAt.toISOString(),
      humanActive: presence.humanActive,
      assigneeName: presence.assigneeName,
      conversationStatus: presence.conversationStatus,
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

      const messageSelect = {
        id: true,
        direction: true,
        type: true,
        body: true,
        mediaUrl: true,
        mediaType: true,
        channel: true,
        status: true,
        createdAt: true,
      } as const;

      const rows = since
        ? await prisma.message.findMany({
            where: {
              conversationId: resolved.conversation.id,
              isPrivate: false,
              createdAt: { gt: since },
            },
            orderBy: { createdAt: "asc" },
            take: LIST_LIMIT,
            select: messageSelect,
          })
        : (
            await prisma.message.findMany({
              where: {
                conversationId: resolved.conversation.id,
                isPrivate: false,
              },
              orderBy: { createdAt: "desc" },
              take: LIST_LIMIT,
              select: messageSelect,
            })
          ).reverse();

      const presence = await loadWebchatPresence(resolved.conversation.id);

      return {
        ok: true,
        messages: rows.map(toPublicMessage),
        humanActive: presence.humanActive,
        assigneeName: presence.assigneeName,
      };
    },
  );

  /**
   * Upload de áudio pelo cliente (Web Chat público).
   */
  app.post<{ Params: { token: string } }>("/:token/upload-audio", async (request, reply) => {
    if (
      rateLimited(`upload:${request.params.token}`, 20, 60_000) ||
      rateLimited(`ip:${clientIp(request)}`, 60, 60_000)
    ) {
      return reply.status(429).send({ error: "Too Many Requests", statusCode: 429 });
    }
    const resolved = await resolvePublicWebchatSession(request, request.params.token);
    if (!resolved.ok) return sessionError(reply, resolved.code);

    const file = await request.file({ limits: { fileSize: 16 * 1024 * 1024 } });
    if (!file) {
      return reply.status(400).send({ error: "Bad Request", message: "multipart file field required", statusCode: 400 });
    }
    const out = await persistMultipartMedia(
      file,
      allowAudioVoiceUpload,
      "Only audio/* (or video/webm voice) allowed",
      reply,
    );
    if (!out) return;
    return reply.status(201).send(out);
  });

  /** Upload imagem / documento / vídeo pelo cliente (Web Chat público). */
  app.post<{ Params: { token: string } }>("/:token/upload-media", async (request, reply) => {
    if (
      rateLimited(`upload:${request.params.token}`, 20, 60_000) ||
      rateLimited(`ip:${clientIp(request)}`, 60, 60_000)
    ) {
      return reply.status(429).send({ error: "Too Many Requests", statusCode: 429 });
    }
    const resolved = await resolvePublicWebchatSession(request, request.params.token);
    if (!resolved.ok) return sessionError(reply, resolved.code);

    const file = await request.file({ limits: { fileSize: 16 * 1024 * 1024 } });
    if (!file) {
      return reply.status(400).send({ error: "Bad Request", message: "multipart file field required", statusCode: 400 });
    }
    const out = await persistMultipartMedia(
      file,
      allowRichMediaUpload,
      "Allowed: image/*, audio/*, video/*, application/pdf, Word .doc/.docx",
      reply,
    );
    if (!out) return;
    return reply.status(201).send(out);
  });

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

    const resolved = await resolvePublicWebchatSession(request, request.params.token);
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

    const messageType = resolveInboundMessageType({
      type: parsed.data.type,
      mediaUrl: parsed.data.mediaUrl ?? null,
      mediaType: parsed.data.mediaType ?? null,
    });
    const bodyText = parsed.data.content?.trim().slice(0, MAX_BODY_CHARS) || null;

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        type: messageType,
        body: bodyText,
        mediaUrl: parsed.data.mediaUrl ?? null,
        mediaType: parsed.data.mediaType ?? null,
        channel: "WEBCHAT",
        status: "DELIVERED",
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    await dispatchWebchatInbound({
      organizationId,
      conversationId: conversation.id,
      contactId: contact.id,
      inboxId: conversation.inboxId,
      message,
      log: request.log,
    });

    return { ok: true, message: toPublicMessage(message) };
  });
}
