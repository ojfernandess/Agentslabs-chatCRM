import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { authenticate, authenticateSessionOrUserApiTokenForApplicationApis } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { sendMessageSchema } from "../lib/messagePayload.js";
import {
  allowAudioVoiceUpload,
  allowRichMediaUpload,
  persistMultipartMedia,
} from "../lib/messageMediaUpload.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";
import { replyPlanEnforcementError } from "../lib/billing/planEnforcement.js";
import { enforceApiEndpointRateLimit } from "../lib/apiEndpointRateLimit.js";

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  /** Upload de áudio (reconhecimento de voz / microfone) — WebM, OGG, MP4, … */
  app.post("/upload-audio", { preHandler: [authenticate] }, async (request, reply) => {
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
  app.post("/upload-media", { preHandler: [authenticate] }, async (request, reply) => {
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

  app.post(
    "/",
    {
      preHandler: [
        authenticateSessionOrUserApiTokenForApplicationApis,
        enforceApiEndpointRateLimit("messages_post"),
      ],
    },
    async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = first?.message ?? parsed.error.message;
      return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
    }

    if (parsed.data.type === "TEMPLATE" && parsed.data.templateId) {
      const tmpl = await prisma.messageTemplate.findFirst({
        where: { id: parsed.data.templateId, organizationId },
      });
      if (!tmpl) {
        return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
      }
      const n = tmpl.bodyVariableCount;
      const p = parsed.data.templateBodyParameters ?? [];
      if (n > 0 && p.length !== n) {
        return reply.status(400).send({
          error: "Bad Request",
          message: `This template requires ${n} variable value(s) in templateBodyParameters`,
          statusCode: 400,
        });
      }
      if (n === 0 && p.length > 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "This template has no body variables; omit templateBodyParameters",
          statusCode: 400,
        });
      }
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
      if (replyPlanEnforcementError(reply, err)) return;
      const msg = err instanceof Error ? err.message : "Request failed";
      if (msg === "Contact not found") {
        return reply.status(404).send({ error: "Not Found", message: msg, statusCode: 404 });
      }
      if (msg === "Contact is blocked") {
        return reply.status(403).send({ error: "Forbidden", message: msg, statusCode: 403, code: "contact_blocked" });
      }
      if (msg === "Template not found") {
        return reply.status(404).send({ error: "Not Found", message: msg, statusCode: 404 });
      }
      if (msg.includes("session window")) {
        return reply.status(422).send({ error: "Unprocessable Entity", message: msg, statusCode: 422 });
      }
      if (msg.includes("Meta API error") || msg.includes("WhatsApp delivery")) {
        return reply.status(422).send({ error: "Unprocessable Entity", message: msg, statusCode: 422 });
      }
      if (msg.includes("templates are only supported")) {
        return reply.status(422).send({ error: "Unprocessable Entity", message: msg, statusCode: 422 });
      }
      app.log.error(err, "deliverOutboundWhatsAppMessage failed");
      return reply.status(500).send({ error: "Internal Server Error", message: msg, statusCode: 500 });
    }
  });

  app.get<{ Params: { id: string } }>("/:id", { preHandler: [authenticate] }, async (request, reply) => {
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
