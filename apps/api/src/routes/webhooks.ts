import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { getWhatsAppProvider, getWebhookSecret } from "../providers/factory.js";
import { MetaCloudApiProvider } from "../providers/meta.js";
import { getWhatsAppEmbeddedConfig } from "../lib/metaWhatsAppEmbedded.js";
import { normalizePhoneE164 } from "@openconduit/shared";
import { appendTimelineEvent } from "../lib/timeline.js";
import { dispatchAgentBotWebhook } from "../lib/agentBotWebhook.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { ensureConversationForWhatsAppContact } from "../lib/conversationRouting.js";
import { persistEvolutionInboundMediaAsLocalUrl } from "../lib/evolutionInboundMedia.js";

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

function extractMetaWebhookPhoneNumberId(body: unknown): string | null {
  const b = body as {
    entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[];
  };
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id && typeof id === "string") return id;
    }
  }
  return null;
}

async function handleWhatsAppPost(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
  options?: { skipWebhookSignature?: boolean },
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
  if (secret && !options?.skipWebhookSignature) {
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

  const { messages, statusUpdates, contactSync } = provider.parseWebhook(
    request.headers as Record<string, string | undefined>,
    body,
  );

  if (
    messages.length === 0 &&
    statusUpdates.length === 0 &&
    (!contactSync || contactSync.length === 0) &&
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
        "Evolution webhook: nothing parsed — enable MESSAGES_UPSERT, MESSAGES_UPDATE and CONTACTS_* on the instance webhook, and use POST base URL /api/v1/whatsapp/:orgId",
      );
    }
  }

  for (const patch of contactSync ?? []) {
    try {
      const phone = normalizePhoneE164(patch.phone);
      if (!phone) continue;
      const existing = await prisma.contact.findFirst({
        where: { organizationId, phone },
      });
      if (!existing) continue;
      const data: {
        profilePictureUrl?: string | null;
        name?: string;
      } = {};
      if (patch.profilePictureUrl !== undefined && patch.profilePictureUrl !== null) {
        data.profilePictureUrl = patch.profilePictureUrl;
      } else if (patch.profilePictureUrl === null) {
        data.profilePictureUrl = null;
      }
      const dn = patch.waDisplayName?.trim();
      if (dn) {
        const nameDigits = existing.name.replace(/\D/g, "");
        const phoneDigits = phone.replace(/\D/g, "");
        const nameLooksLikePhone = nameDigits.length >= 7 && nameDigits === phoneDigits;
        if (nameLooksLikePhone || existing.name === phone || existing.name === "Desconhecido") {
          data.name = dn;
        }
      }
      if (Object.keys(data).length > 0) {
        await prisma.contact.update({ where: { id: existing.id }, data });
      }
    } catch (err) {
      app.log.error(err, "Error applying contact sync from webhook");
    }
  }

  let channelSettings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
  if (!channelSettings) {
    channelSettings = await prisma.settings.create({
      data: { organizationId },
      include: { agentBot: true },
    });
  }
  const useAgentBot =
    Boolean(channelSettings.agentBotId) &&
    Boolean(channelSettings.agentBot?.isActive) &&
    Boolean(channelSettings.agentBot?.webhookUrl?.trim());

  const whatsappGroupsEnabled = await isOrganizationFeatureEnabled(organizationId, "whatsapp_groups");

  for (const msg of messages) {
    try {
      if (msg.isGroup && !whatsappGroupsEnabled) {
        app.log.info(
          { organizationId, groupJid: msg.groupJid },
          "Ignoring WhatsApp group message (feature whatsapp_groups disabled for organization)",
        );
        continue;
      }

      const phone = normalizePhoneE164(msg.from);
      if (!phone) {
        app.log.warn(`Invalid phone number from webhook: ${msg.from}`);
        continue;
      }

      let inboundBody = msg.body;
      if (msg.isGroup && (msg.participantPushName || msg.participantE164)) {
        const who = (msg.participantPushName || msg.participantE164 || "").trim();
        if (who) {
          inboundBody = inboundBody?.trim() ? `[${who}] ${inboundBody}` : `[${who}]`;
        }
      }

      let contact = await prisma.contact.findFirst({
        where: { organizationId, phone },
      });
      let contactJustCreated = false;

      if (msg.isGroup && contact && (contact.waId !== msg.groupJid || !contact.isGroupChat)) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: {
            waId: msg.groupJid!,
            isGroupChat: true,
          },
        });
      }

      if (!contact) {
        const gid = (msg.groupJid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
        const defaultGroupName =
          gid.length >= 4 ? `Grupo · ${gid.slice(-8)}` : "Grupo WhatsApp";
        contact = await prisma.contact.create({
          data: {
            organizationId,
            phone,
            name: msg.isGroup ? defaultGroupName : phone,
            waId: msg.isGroup ? msg.groupJid! : msg.from,
            isGroupChat: Boolean(msg.isGroup),
          },
        });
        contactJustCreated = true;

        const unknownTag = await prisma.tag.findFirst({
          where: { organizationId, name: "Desconhecido" },
        });
        if (unknownTag && !msg.isGroup) {
          await prisma.contactTag.create({
            data: { contactId: contact.id, tagId: unknownTag.id },
          });
        }

        if (provider.fetchContactProfilePictureUrl && !msg.isGroup) {
          const pic = await provider.fetchContactProfilePictureUrl(phone).catch(() => undefined);
          if (pic) {
            contact = await prisma.contact.update({
              where: { id: contact.id },
              data: { profilePictureUrl: pic },
            });
          }
        }
      }

      if (
        !contactJustCreated &&
        provider.fetchContactProfilePictureUrl &&
        !contact.profilePictureUrl &&
        !msg.isGroup
      ) {
        const pic = await provider.fetchContactProfilePictureUrl(phone).catch(() => undefined);
        if (pic) {
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { profilePictureUrl: pic },
          });
        }
      }

      if (channelSettings.autoOptInOnFirstMessage && !contact.optedIn) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { optedIn: true, optedInAt: new Date() },
        });
      }

      const push = msg.pushName?.trim();
      if (push && !msg.isGroup) {
        const nameDigits = contact.name.replace(/\D/g, "");
        const phoneDigits = phone.replace(/\D/g, "");
        const nameLooksLikePhone = nameDigits.length >= 7 && nameDigits === phoneDigits;
        if (nameLooksLikePhone || contact.name === phone || contact.name === "Desconhecido") {
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { name: push },
          });
        }
      }

      let conversation = await ensureConversationForWhatsAppContact({
        organizationId,
        contactId: contact.id,
        lockSingleConversation: channelSettings.lockSingleConversation,
        activeConversationStatus: useAgentBot ? "PENDING" : "OPEN",
        createDefaults: {
          status: useAgentBot ? "PENDING" : "OPEN",
          assignedToId: null,
        },
      });

      let resolvedMediaUrl: string | null = msg.mediaUrl ?? null;
      let resolvedMediaType: string | null = msg.mediaType ?? null;
      if (
        channelSettings.whatsappProvider === "evolution" &&
        msg.type === "AUDIO" &&
        msg.evolutionWebMessage
      ) {
        const tryPersist = () =>
          persistEvolutionInboundMediaAsLocalUrl({
            organizationId,
            evolutionWebMessage: msg.evolutionWebMessage!,
          });
        let local = await tryPersist();
        if (!local) {
          await new Promise((r) => setTimeout(r, 1200));
          local = await tryPersist();
        }
        if (local) {
          resolvedMediaUrl = local.mediaUrl;
          resolvedMediaType = local.mediaType;
        } else {
          app.log.warn(
            { organizationId, waMessageId: msg.waMessageId },
            "Evolution inbound audio: getBase64FromMediaMessage failed — using original URL if any",
          );
        }
      }

      const inbound = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          type: msg.type as "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO",
          body: inboundBody,
          mediaUrl: resolvedMediaUrl,
          mediaType: resolvedMediaType,
          providerMsgId: msg.waMessageId,
          status: "DELIVERED",
          sentAt: msg.timestamp,
        },
      });

      await appendTimelineEvent({
        organizationId,
        subjectType: "CONTACT",
        subjectId: contact.id,
        eventType: "message.inbound",
        channel: "whatsapp",
        payload: {
          messageId: inbound.id,
          conversationId: conversation.id,
          type: msg.type,
          body: inboundBody ?? null,
          mediaUrl: resolvedMediaUrl ?? null,
          providerMsgId: msg.waMessageId ?? null,
        },
        sourceId: msg.waMessageId ?? inbound.id,
        occurredAt: msg.timestamp ?? new Date(),
      }).catch((err) => {
        app.log.warn({ err }, "Failed to append contact timeline event");
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      if (inboundBody) {
        const rules = await prisma.autoTagRule.findMany({ where: { organizationId } });
        for (const rule of rules) {
          if (inboundBody.toLowerCase().includes(rule.keyword.toLowerCase())) {
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

      if (useAgentBot && channelSettings.agentBot && channelSettings.agentBotId) {
        const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id } });
        if (fresh) {
          void dispatchAgentBotWebhook({
            organizationId,
            settings: {
              agentBotId: channelSettings.agentBotId,
              agentBot: channelSettings.agentBot,
            },
            conversation: fresh,
            contact,
            message: inbound,
            log: app.log,
          });
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
  app.get("/meta/whatsapp", async (request, reply) => {
    const cfg = await getWhatsAppEmbeddedConfig();
    if (!cfg) {
      return reply.status(503).send({ error: "WhatsApp Embedded not configured" });
    }
    const q = request.query as Record<string, string | undefined>;
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"];
    if (mode === "subscribe" && token === cfg.webhookVerifyToken && challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.status(403).send({ error: "Verification failed" });
  });

  app.post("/meta/whatsapp", rawBodyPost, async (request: FastifyRequest, reply: FastifyReply) => {
    const cfg = await getWhatsAppEmbeddedConfig();
    if (!cfg) {
      return reply.status(503).send();
    }
    const body = normalizeJsonBody(request.body);
    if (body === null) {
      return reply.status(400).send({ error: "Invalid JSON body" });
    }
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    const metaVerifier = new MetaCloudApiProvider("unused", "unused");
    const valid = metaVerifier.validateWebhookSignature(
      request.headers as Record<string, string | undefined>,
      rawBody,
      cfg.appSecret,
    );
    if (!valid) {
      app.log.warn("meta/whatsapp webhook signature validation failed");
      return reply.status(401).send({ error: "Invalid signature" });
    }
    const phoneId = extractMetaWebhookPhoneNumberId(body);
    if (!phoneId) {
      app.log.info({ url: request.url }, "meta/whatsapp: no phone_number_id in payload");
      return reply.status(200).send();
    }
    const row = await prisma.settings.findFirst({
      where: { whatsappPhoneNumberId: phoneId },
      select: { organizationId: true },
    });
    if (!row) {
      app.log.warn({ phoneId }, "meta/whatsapp: no organization for phone_number_id");
      return reply.status(200).send();
    }
    return handleWhatsAppPost(app, request, reply, row.organizationId, { skipWebhookSignature: true });
  });

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
      async (
        request: FastifyRequest<{ Params: { organizationId: string } }>,
        reply: FastifyReply,
      ) => {
        return handleWhatsAppPost(app, request, reply, request.params.organizationId);
      },
    );
  }
}
