import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { getWhatsAppProvider, getWebhookSecret } from "../providers/factory.js";
import { normalizePhoneE164 } from "@openconduit/shared";

// Fastify: raw body for signature verification (Evolution / Meta)
const rawBodyPost = { config: { rawBody: true } } as any;

/** Evolution may post to `/whatsapp/:orgId` ou subpaths como `.../messages-upsert`. */
const WHATSAPP_POST_SUFFIXES = ["", "/messages-upsert", "/messages-update"] as const;

function normalizeJsonBody(body: unknown): unknown {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  return body;
}

async function handleWhatsAppPost(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isActive: true },
  });
  if (!org?.isActive) {
    app.log.warn({ organizationId }, "Webhook ignored: organization suspended");
    return reply.status(503).send();
  }

  app.log.info(
    { url: request.url, contentLength: request.headers["content-length"], organizationId },
    "WhatsApp webhook POST received",
  );

  const provider = await getWhatsAppProvider(organizationId);
  if (!provider) {
    app.log.warn({ organizationId }, "Webhook received but no provider configured for organization");
    return reply.status(200).send();
  }

  let body = normalizeJsonBody(request.body);
  if (body === null) {
    return reply.status(400).send({ error: "Invalid JSON body" });
  }

  const secret = await getWebhookSecret(organizationId);
  if (secret) {
    const rawBody =
      typeof request.body === "string" ? request.body : JSON.stringify(request.body);

    const valid = provider.validateWebhookSignature(
      request.headers as Record<string, string | undefined>,
      rawBody,
      secret,
    );

    if (!valid) {
      app.log.warn({ organizationId }, "Webhook signature validation failed");
      return reply.status(401).send({ error: "Invalid signature" });
    }
  }

  const { messages, statusUpdates } = provider.parseWebhook(
    request.headers as Record<string, string | undefined>,
    body,
  );

  if (
    messages.length === 0 &&
    statusUpdates.length === 0 &&
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    const env = body as Record<string, unknown>;
    const settingsRow = await prisma.settings.findUnique({ where: { organizationId } });
    if (settingsRow?.whatsappProvider === "evolution") {
      app.log.warn(
        {
          event: env.event,
          url: request.url,
          organizationId,
        },
        "Evolution webhook: no messages or status updates parsed — enable MESSAGES_UPSERT on the instance webhook URL",
      );
    }
  }

  for (const msg of messages) {
    try {
      const phone = normalizePhoneE164(msg.from);
      if (!phone) {
        app.log.warn(`Invalid phone number from webhook: ${msg.from}`);
        continue;
      }

      let contact = await prisma.contact.findFirst({
        where: { organizationId, phone },
      });
      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            organizationId,
            phone,
            name: phone,
            waId: msg.from,
          },
        });

        const unknownTag = await prisma.tag.findFirst({
          where: { organizationId, name: "Desconhecido" },
        });
        if (unknownTag) {
          await prisma.contactTag.create({
            data: { contactId: contact.id, tagId: unknownTag.id },
          });
        }
      }

      const settings = await prisma.settings.findUnique({ where: { organizationId } });
      if (settings?.autoOptInOnFirstMessage && !contact.optedIn) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { optedIn: true, optedInAt: new Date() },
        });
      }

      let conversation = await prisma.conversation.findFirst({
        where: { organizationId, contactId: contact.id, status: { not: "RESOLVED" } },
        orderBy: { updatedAt: "desc" },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { organizationId, contactId: contact.id, status: "OPEN" },
        });
      } else if (conversation.status === "PENDING") {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: "OPEN" },
        });
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          type: msg.type as "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO",
          body: msg.body,
          mediaUrl: msg.mediaUrl,
          mediaType: msg.mediaType,
          providerMsgId: msg.waMessageId,
          status: "DELIVERED",
          sentAt: msg.timestamp,
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      if (msg.body) {
        const rules = await prisma.autoTagRule.findMany({ where: { organizationId } });
        for (const rule of rules) {
          if (msg.body.toLowerCase().includes(rule.keyword.toLowerCase())) {
            await prisma.contactTag.upsert({
              where: {
                contactId_tagId: {
                  contactId: contact.id,
                  tagId: rule.tagId,
                },
              },
              create: { contactId: contact.id, tagId: rule.tagId },
              update: {},
            });
          }
        }
      }
    } catch (err) {
      app.log.error(err, "Error processing incoming webhook message");
    }
  }

  for (const status of statusUpdates) {
    try {
      await prisma.message.updateMany({
        where: {
          providerMsgId: status.waMessageId,
          conversation: { organizationId },
        },
        data: { status: status.status },
      });
    } catch (err) {
      app.log.error(err, "Error processing status update");
    }
  }

  return reply.status(200).send();
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { organizationId: string } }>("/whatsapp/:organizationId", async (request, reply) => {
    const { organizationId } = request.params;
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { isActive: true },
    });
    if (!org?.isActive) {
      return reply.status(503).send({ error: "Organization suspended" });
    }
    const provider = await getWhatsAppProvider(organizationId);
    if (!provider) {
      return reply.status(503).send({ error: "Provider not configured" });
    }

    const challenge = provider.handleVerification(request.query as Record<string, string>);

    if (challenge) {
      return reply.type("text/plain").send(challenge);
    }

    return reply.status(403).send({ error: "Verification failed" });
  });

  for (const suffix of WHATSAPP_POST_SUFFIXES) {
    app.post<{ Params: { organizationId: string } }>(
      `/whatsapp/:organizationId${suffix}`,
      rawBodyPost,
      async (request, reply) => {
        return handleWhatsAppPost(app, request, reply, request.params.organizationId);
      },
    );
  }
}
