import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { WHATSAPP_SESSION_WINDOW_HOURS } from "@openconduit/shared";
import { getWhatsAppProvider } from "../providers/factory.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { sendMessageSchema } from "../lib/messagePayload.js";
import { config, getPublicOrigin } from "../config.js";

function extensionForMimetype(mimetype: string): string {
  const m = mimetype.split(";")[0].trim().toLowerCase();
  if (m === "audio/webm") return "webm";
  if (m === "audio/ogg" || m === "audio/opus") return "ogg";
  if (m === "audio/mpeg") return "mp3";
  if (m === "audio/mp4" || m === "audio/x-m4a") return "m4a";
  if (m === "audio/amr") return "amr";
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  if (m === "video/webm") return "webm";
  return "bin";
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** Upload de áudio para obter URL HTTPS pública (requisito Cloud API / Evolution com link). */
  app.post("/upload-audio", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const file = await request.file({ limits: { fileSize: 16 * 1024 * 1024 } });
    if (!file) {
      return reply.status(400).send({ error: "Bad Request", message: "multipart file field required", statusCode: 400 });
    }

    const rawMime = file.mimetype ?? "";
    const mime = rawMime.split(";")[0].trim().toLowerCase();
    const allowed = mime.startsWith("audio/") || mime === "video/webm";
    if (!allowed) {
      return reply
        .status(415)
        .send({ error: "Unsupported Media Type", message: "Only audio/* (or video/webm voice) allowed", statusCode: 415 });
    }

    const buf = await file.toBuffer();
    const ext = extensionForMimetype(rawMime);
    const token = randomBytes(16).toString("hex");
    const filename = `${token}.${ext}`;
    const dir = config.mediaUploadDir;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buf);

    const mediaUrl = `${getPublicOrigin()}/api/v1/messages/media/${filename}`;
    return reply.status(201).send({ mediaUrl });
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

    const { contactId, type, body, templateId, mediaUrl } = parsed.data;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
    });
    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    if (type !== "TEMPLATE") {
      const lastInbound = await prisma.message.findFirst({
        where: {
          conversation: { contactId, organizationId },
          direction: "INBOUND",
        },
        orderBy: { createdAt: "desc" },
      });

      if (lastInbound) {
        const hoursSinceLastInbound =
          (Date.now() - lastInbound.createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastInbound > WHATSAPP_SESSION_WINDOW_HOURS) {
          return reply.status(422).send({
            error: "Unprocessable Entity",
            message: "Outside 24-hour session window. Only template messages can be sent.",
            statusCode: 422,
          });
        }
      }
    }

    let conversation = await prisma.conversation.findFirst({
      where: { organizationId, contactId, status: { not: "RESOLVED" } },
      orderBy: { updatedAt: "desc" },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          organizationId,
          contactId,
          status: "OPEN",
          assignedToId: request.user.id,
        },
      });
    }

    let messageBody = body;
    if (type === "TEMPLATE" && templateId) {
      const template = await prisma.messageTemplate.findFirst({
        where: { id: templateId, organizationId },
      });
      if (!template) {
        return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
      }
      messageBody = template.body;
    }

    let providerMsgId: string | undefined;
    try {
      const provider = await getWhatsAppProvider(organizationId);
      if (provider) {
        providerMsgId = await provider.sendMessage({
          to: contact.phone,
          type,
          body: messageBody,
          mediaUrl,
        });
      }
    } catch (err) {
      app.log.error(err, "Failed to send message via WhatsApp provider");
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        type,
        body: messageBody,
        mediaUrl,
        mediaType: type === "AUDIO" ? "audio/*" : undefined,
        providerMsgId,
        status: providerMsgId ? "SENT" : "FAILED",
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return reply.status(201).send(message);
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
