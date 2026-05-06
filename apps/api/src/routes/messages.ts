import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { sendMessageSchema } from "../lib/messagePayload.js";
import { config, getPublicOrigin } from "../config.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";

function extensionForUploadMimetype(mimetype: string, originalFilename?: string): string {
  const m = mimetype.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "video/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };
  if (map[m]) return map[m];
  const ext = originalFilename?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "bin";
}

function normalizeMultipartMime(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

function allowAudioVoiceUpload(mime: string): boolean {
  const m = normalizeMultipartMime(mime);
  return m.startsWith("audio/") || m === "video/webm";
}

function allowRichMediaUpload(mime: string): boolean {
  const m = normalizeMultipartMime(mime);
  if (m.startsWith("image/")) return true;
  if (m.startsWith("audio/")) return true;
  if (m.startsWith("video/")) return true;
  if (m === "video/webm") return true;
  if (m === "application/pdf") return true;
  if (m === "application/msword") return true;
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return false;
}

async function persistMultipartMedia(
  file: MultipartFile,
  allow: (mime: string) => boolean,
  rejectDetail: string,
  reply: FastifyReply,
): Promise<{ mediaUrl: string; mimeType: string } | null> {
  const rawMime = file.mimetype ?? "";
  if (!allow(rawMime)) {
    await reply.status(415).send({
      error: "Unsupported Media Type",
      message: rejectDetail,
      statusCode: 415,
    });
    return null;
  }

  const mime = normalizeMultipartMime(rawMime);

  const buf = await file.toBuffer();
  const ext = extensionForUploadMimetype(rawMime, file.filename ?? undefined);
  const token = randomBytes(16).toString("hex");
  const filename = `${token}.${ext}`;
  const dir = config.mediaUploadDir;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buf);

  const mediaUrl = `${getPublicOrigin()}/api/v1/messages/media/${filename}`;
  return { mediaUrl, mimeType: mime || "application/octet-stream" };
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** Upload de áudio (reconhecimento de voz / microfone) — WebM, OGG, MP4, … */
  app.post("/upload-audio", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

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

  /** Upload imagem / vídeo / PDF / áudio para URL pública (Evolution sendMedia, Meta link, …). */
  app.post("/upload-media", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

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

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = first?.message ?? parsed.error.message;
      return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
    }

    try {
      const { message } = await deliverOutboundWhatsAppMessage({
        organizationId,
        data: parsed.data,
        actor: { kind: "user", userId: request.user.id },
        log: app.log,
        newConversation: { status: "OPEN", assignedToId: request.user.id },
      });
      return reply.status(201).send(message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      if (msg === "Contact not found") {
        return reply.status(404).send({ error: "Not Found", message: msg, statusCode: 404 });
      }
      if (msg === "Template not found") {
        return reply.status(404).send({ error: "Not Found", message: msg, statusCode: 404 });
      }
      if (msg.includes("session window")) {
        return reply.status(422).send({ error: "Unprocessable Entity", message: msg, statusCode: 422 });
      }
      app.log.error(err, "deliverOutboundWhatsAppMessage failed");
      return reply.status(500).send({ error: "Internal Server Error", message: msg, statusCode: 500 });
    }
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const message = await prisma.message.findFirst({
      where: {
        id: request.params.id,
        conversation: { organizationId },
      },
      include: { conversation: { include: { contact: true } } },
    });

    if (!message) {
      return reply.status(404).send({ error: "Not Found", message: "Message not found", statusCode: 404 });
    }

    return message;
  });
}
