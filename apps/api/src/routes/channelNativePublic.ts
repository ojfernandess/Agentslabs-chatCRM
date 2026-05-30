import type { FastifyInstance, FastifyReply } from "fastify";
import formbody from "@fastify/formbody";
import { z } from "zod";
import { processChannelInboxInbound } from "../lib/channelInboxIngest.js";
import { loadInboxByIngestToken } from "../lib/publicInboxLookup.js";
import type { MessageType } from "@prisma/client";
import type { ChannelNativeConfig } from "../lib/channelNativeTypes.js";

/**
 * Rotas públicas «nativas» (estilo Chatwoot Client/Live chat), sem expor JSON genérico tipo webhook.
 * Ref.: https://developers.chatwoot.com/api-reference/messages-api/create-a-message
 */
function setCorsPublic(reply: FastifyReply) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
}

const chatwootClientMessageSchema = z.object({
  content: z.string().min(1).max(16000),
  echo_id: z.string().max(128).optional(),
  name: z.string().max(255).optional(),
  email: z.string().email().optional(),
});

function facebookVerifyTokenFromConfig(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== "object") return null;
  const t = (cfg as ChannelNativeConfig).facebookVerifyToken;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function instagramVerifyTokenFromConfig(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== "object") return null;
  const c = cfg as ChannelNativeConfig;
  const t = c.instagramVerifyToken ?? c.facebookVerifyToken;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function extractFacebookMessaging(body: unknown): {
  senderId: string;
  text: string;
  mid?: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const entry = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const messaging = (entry[0] as { messaging?: unknown[] }).messaging;
  if (!Array.isArray(messaging) || messaging.length === 0) return null;
  const m = messaging[0] as {
    sender?: { id?: string };
    message?: { text?: string; mid?: string };
  };
  const senderId = m.sender?.id;
  if (!senderId) return null;
  const text = m.message?.text?.trim();
  if (!text) return null;
  return { senderId, text, mid: m.message?.mid };
}

function extractLineMessage(body: unknown): {
  participantId: string;
  text: string;
  externalMessageId?: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const events = (body as { events?: unknown[] }).events;
  if (!Array.isArray(events) || events.length === 0) return null;
  const ev = events[0] as {
    type?: string;
    message?: { type?: string; text?: string; id?: string };
    source?: { userId?: string; groupId?: string };
  };
  if (ev.type !== "message" || !ev.message || ev.message.type !== "text") return null;
  const text = typeof ev.message.text === "string" ? ev.message.text.trim() : "";
  if (!text) return null;
  const participantId = ev.source?.userId ?? ev.source?.groupId;
  if (!participantId) return null;
  const mid = typeof ev.message.id === "string" ? ev.message.id : undefined;
  return { participantId, text, externalMessageId: mid };
}

export async function channelNativePublicRoutes(app: FastifyInstance): Promise<void> {
  await app.register(formbody);

  const preflight = async (_req: unknown, reply: FastifyReply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  };

  for (const path of [
    "/inboxes/:token/contacts/:contactIdentifier/messages",
    "/inboxes/:token/telegram",
    "/inboxes/:token/twilio",
    "/inboxes/:token/facebook",
    "/inboxes/:token/instagram",
    "/inboxes/:token/line",
  ]) {
    app.options(path, preflight);
  }

  /**
   * Client API (widget / visitante): identificador estável por visitante (UUID no browser).
   * POST .../contacts/:contactIdentifier/messages { content, name?, email? }
   */
  app.post<{ Params: { token: string; contactIdentifier: string } }>(
    "/inboxes/:token/contacts/:contactIdentifier/messages",
    async (request, reply) => {
      setCorsPublic(reply);
      const inbox = await loadInboxByIngestToken(request.params.token);
      if (!inbox || !inbox.organization.isActive) {
        return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
      }
      if (inbox.channelType !== "WEBSITE" && inbox.channelType !== "API") {
        return reply.status(400).send({
          error: "Bad Request",
          message: "This endpoint is for Website or API channel inboxes",
          statusCode: 400,
        });
      }

      const pid = request.params.contactIdentifier?.trim();
      if (!pid || pid.length > 500) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid contact identifier", statusCode: 400 });
      }

      const raw = request.body;
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return reply.status(400).send({ error: "Bad Request", message: "JSON object body required", statusCode: 400 });
      }

      const parsed = chatwootClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return reply
          .status(400)
          .send({ error: "Bad Request", message: first?.message ?? parsed.error.message, statusCode: 400 });
      }

      const p = parsed.data;
      try {
        const result = await processChannelInboxInbound({
          organizationId: inbox.organizationId,
          inboxId: inbox.id,
          channelType: inbox.channelType,
          participantId: pid,
          participantName: p.name,
          email: p.email ?? null,
          body: p.content,
          type: "TEXT" as MessageType,
          externalMessageId: p.echo_id ?? null,
          log: app.log,
        });
        return reply.status(201).send(result);
      } catch (err) {
        app.log.error(err, "native website client message failed");
        return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
      }
    },
  );

  /** Facebook Messenger: verificação do webhook (Graph API). */
  app.get<{
    Params: { token: string };
    Querystring: { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
  }>("/inboxes/:token/facebook", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "FACEBOOK") {
      return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
    }
    const mode = request.query["hub.mode"];
    const verify = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];
    const expected = facebookVerifyTokenFromConfig(inbox.channelConfig);
    if (mode === "subscribe" && expected && verify === expected && typeof challenge === "string") {
      reply.type("text/plain");
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
  });

  app.post<{ Params: { token: string } }>("/inboxes/:token/facebook", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "FACEBOOK") {
      return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const raw = request.body;
    if (raw == null || typeof raw !== "object") {
      return reply.status(200).send({ ok: true });
    }

    const extracted = extractFacebookMessaging(raw);
    if (!extracted) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    try {
      const result = await processChannelInboxInbound({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelType: inbox.channelType,
        participantId: extracted.senderId,
        body: extracted.text,
        type: "TEXT",
        externalMessageId: extracted.mid ?? null,
        log: app.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      app.log.error(err, "facebook native ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });

  /** Instagram Messaging (Graph) — verificação e mensagens (payload semelhante ao Messenger). */
  app.get<{
    Params: { token: string };
    Querystring: { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
  }>("/inboxes/:token/instagram", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "INSTAGRAM") {
      return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
    }
    const mode = request.query["hub.mode"];
    const verify = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];
    const expected = instagramVerifyTokenFromConfig(inbox.channelConfig);
    if (mode === "subscribe" && expected && verify === expected && typeof challenge === "string") {
      reply.type("text/plain");
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
  });

  app.post<{ Params: { token: string } }>("/inboxes/:token/instagram", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "INSTAGRAM") {
      return reply.status(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const raw = request.body;
    if (raw == null || typeof raw !== "object") {
      return reply.status(200).send({ ok: true });
    }

    const extracted = extractFacebookMessaging(raw);
    if (!extracted) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    try {
      const result = await processChannelInboxInbound({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelType: inbox.channelType,
        participantId: extracted.senderId,
        body: extracted.text,
        type: "TEXT",
        externalMessageId: extracted.mid ?? null,
        log: app.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      app.log.error(err, "instagram native ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });

  /** LINE Messaging API — webhook JSON (`events`). */
  app.post<{ Params: { token: string } }>("/inboxes/:token/line", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "LINE") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "This URL is only for LINE channel inboxes",
        statusCode: 400,
      });
    }

    const raw = request.body;
    if (raw == null || typeof raw !== "object") {
      return reply.status(200).send({ ok: true });
    }

    const extracted = extractLineMessage(raw);
    if (!extracted) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    try {
      const result = await processChannelInboxInbound({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelType: inbox.channelType,
        participantId: extracted.participantId,
        body: extracted.text,
        type: "TEXT",
        externalMessageId: extracted.externalMessageId ?? null,
        log: app.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      app.log.error(err, "line native ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });

  /** Telegram Bot API — URL «nativa» (setWebhook aponta aqui). */
  app.post<{ Params: { token: string } }>("/inboxes/:token/telegram", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "TELEGRAM") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "This URL is only for Telegram channel inboxes",
        statusCode: 400,
      });
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
      app.log.error(err, "native telegram ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });

  /** Twilio SMS / Voice callback (form body). */
  app.post<{ Params: { token: string } }>("/inboxes/:token/twilio", async (request, reply) => {
    setCorsPublic(reply);
    const inbox = await loadInboxByIngestToken(request.params.token);
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }
    if (inbox.channelType !== "SMS" && inbox.channelType !== "VOICE") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "This Twilio URL is only for SMS or Voice channel inboxes",
        statusCode: 400,
      });
    }

    const body = request.body as Record<string, unknown> | undefined;
    const from = typeof body?.From === "string" ? body.From : typeof body?.from === "string" ? body.from : "";
    const text = typeof body?.Body === "string" ? body.Body : typeof body?.body === "string" ? body.body : "";
    const sid =
      typeof body?.MessageSid === "string" ? body.MessageSid : typeof body?.SmsSid === "string" ? body.SmsSid : null;

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
      app.log.error(err, "native twilio ingest failed");
      return reply.status(500).send({ error: "Internal Server Error", statusCode: 500 });
    }
  });
}
