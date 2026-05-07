import type { FastifyInstance, FastifyReply } from "fastify";
import formbody from "@fastify/formbody";
import { z } from "zod";
import { prisma } from "../db.js";
import { processChannelInboxInbound } from "../lib/channelInboxIngest.js";
import type { MessageType } from "@prisma/client";

function setCorsPublic(reply: FastifyReply) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const jsonInboundSchema = z.object({
  participantId: z.string().min(1).max(500),
  participantName: z.string().max(255).optional(),
  email: z.string().email().optional().nullable(),
  text: z.string().max(16000).optional().nullable(),
  body: z.string().max(16000).optional().nullable(),
  type: z.enum(["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO"]).optional(),
  mediaUrl: z.union([z.string().url().max(2048), z.string().max(2048)]).optional().nullable(),
  mediaType: z.string().max(128).optional().nullable(),
  externalMessageId: z.string().max(512).optional().nullable(),
});

async function loadInboxByToken(token: string) {
  const t = token?.trim();
  if (!t || t.length < 16) return null;
  return prisma.inbox.findFirst({
    where: { ingestToken: t },
    include: { organization: { select: { id: true, isActive: true } } },
  });
}

export async function channelInboxPublicRoutes(app: FastifyInstance): Promise<void> {
  await app.register(formbody);

  const preflight = async (_req: unknown, reply: FastifyReply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  };

  for (const path of ["/:token/inbound", "/:token/telegram", "/:token/twilio"]) {
    app.options(path, preflight);
  }

  app.post<{ Params: { token: string } }>("/:token/inbound", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const raw = request.body;
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return reply.status(400).send({ error: "Bad Request", message: "JSON object body required", statusCode: 400 });
    }

    const parsed = jsonInboundSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply
        .status(400)
        .send({ error: "Bad Request", message: first?.message ?? parsed.error.message, statusCode: 400 });
    }

    const p = parsed.data;
    const bodyText = p.body ?? p.text ?? null;
    const type = (p.type ?? "TEXT") as MessageType;

    try {
      const result = await processChannelInboxInbound({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelType: inbox.channelType,
        participantId: p.participantId,
        participantName: p.participantName,
        email: p.email ?? null,
        body: bodyText,
        type,
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
        externalMessageId: p.externalMessageId,
        log: app.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      app.log.error(err, "channel inbox inbound failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });

  /** Corpo JSON do Bot API do Telegram (`update`). */
  app.post<{ Params: { token: string } }>("/:token/telegram", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const raw = request.body;
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return reply.status(400).send({ error: "Bad Request", message: "JSON object body required", statusCode: 400 });
    }

    const msg = (raw as { message?: Record<string, unknown>; edited_message?: Record<string, unknown> }).message ??
      (raw as { edited_message?: Record<string, unknown> }).edited_message;
    if (!msg || typeof msg !== "object") {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    const chat = msg.chat as { id?: unknown } | undefined;
    const from = msg.from as { id?: unknown; first_name?: string; username?: string } | undefined;
    const chatId = chat?.id;
    const participantId = chatId != null ? String(chatId) : from?.id != null ? String(from.id) : null;
    if (!participantId) {
      return reply.status(400).send({ error: "Bad Request", message: "Missing chat/user id", statusCode: 400 });
    }

    const name =
      [from?.first_name, from && "username" in from ? (from as { username?: string }).username : undefined]
        .filter(Boolean)
        .join(" ")
        .trim() || undefined;

    const text =
      typeof msg.text === "string"
        ? msg.text
        : typeof msg.caption === "string"
          ? msg.caption
          : null;

    let type: MessageType = "TEXT";
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;

    if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      type = "IMAGE";
      const last = msg.photo[msg.photo.length - 1] as { file_id?: string };
      if (last.file_id) {
        mediaUrl = `telegram:file_id:${last.file_id}`;
        mediaType = "image/jpeg";
      }
    } else if (msg.document) {
      type = "DOCUMENT";
      const doc = msg.document as { file_id?: string; mime_type?: string };
      if (doc.file_id) {
        mediaUrl = `telegram:file_id:${doc.file_id}`;
        mediaType = doc.mime_type ?? "application/octet-stream";
      }
    } else if (msg.voice) {
      type = "AUDIO";
      const v = msg.voice as { file_id?: string; mime_type?: string };
      if (v.file_id) {
        mediaUrl = `telegram:file_id:${v.file_id}`;
        mediaType = v.mime_type ?? "audio/ogg";
      }
    } else if (msg.video) {
      type = "VIDEO";
      const v = msg.video as { file_id?: string; mime_type?: string };
      if (v.file_id) {
        mediaUrl = `telegram:file_id:${v.file_id}`;
        mediaType = v.mime_type ?? "video/mp4";
      }
    }

    const externalMessageId =
      typeof msg.message_id === "number" || typeof msg.message_id === "string" ? String(msg.message_id) : null;

    try {
      const result = await processChannelInboxInbound({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelType: inbox.channelType,
        participantId,
        participantName: name,
        body: text,
        type,
        mediaUrl,
        mediaType,
        externalMessageId,
        log: app.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      app.log.error(err, "telegram inbox ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });

  /** Twilio (SMS / WhatsApp via Twilio): application/x-www-form-urlencoded. */
  app.post<{ Params: { token: string } }>("/:token/twilio", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const body = request.body as Record<string, unknown> | undefined;
    const from = typeof body?.From === "string" ? body.From : typeof body?.from === "string" ? body.from : "";
    const text = typeof body?.Body === "string" ? body.Body : typeof body?.body === "string" ? body.body : "";
    const sid = typeof body?.MessageSid === "string" ? body.MessageSid : typeof body?.SmsSid === "string" ? body.SmsSid : null;

    if (!from.trim()) {
      return reply.status(400).send({ error: "Bad Request", message: "From is required", statusCode: 400 });
    }

    try {
      const result = await processChannelInboxInbound({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelType: inbox.channelType,
        participantId: from.trim(),
        participantName: undefined,
        body: text.trim() || "(no text)",
        type: "TEXT",
        externalMessageId: sid,
        log: app.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      app.log.error(err, "twilio inbox ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });
}
