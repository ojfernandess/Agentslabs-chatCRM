import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { getWhatsAppProviderForInbox, getWebhookSecretForInbox } from "../providers/factory.js";
import {
  findOrganizationByMetaPhoneNumberId,
  findWhatsappInboxByPhoneNumberId,
  resolveInboxWhatsappCredentials,
} from "../lib/inboxWhatsappConfig.js";
import { MetaCloudApiProvider } from "../providers/meta.js";
import { getWhatsAppEmbeddedConfig } from "../lib/metaWhatsAppEmbedded.js";
import { normalizePhoneE164 } from "@openconduit/shared";
import { appendTimelineEvent } from "../lib/timeline.js";
import { maybeTranscribeInboundAudioMessage } from "../lib/audioTranscription.js";
import { dispatchAgentBotWebhook } from "../lib/agentBotWebhook.js";
import { getAgentBotDispatchContextForInbox } from "../lib/agentBotTriage.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { ensureConversationForChannelInbox } from "../lib/conversationRouting.js";
import { persistEvolutionInboundMediaAsLocalUrl } from "../lib/evolutionInboundMedia.js";
import { persistEvolutionGoInboundMediaAsLocalUrl } from "../lib/evolutionGoInboundMedia.js";
import { persistMetaInboundMediaAsLocalUrl } from "../lib/metaInboundMedia.js";
import { decrypt } from "../lib/encryption.js";
import { getDefaultInboxId } from "../lib/defaultInbox.js";
import {
  evolutionGoWebhookMatchesOrgInstance,
  findEvolutionGoWhatsappInboxId,
  isEvolutionGoWebhookPayload,
} from "../lib/evolutionGoPlatform.js";
import { findContactByInboundPhone } from "../lib/contactPhoneMatch.js";
import { syncContactProfilePicture } from "../lib/contactProfilePictureResolve.js";
import { broadcastConversationUpdated } from "../lib/workspaceHub.js";
import { handleWavoipWebhook, verifyWavoipWebhookSecret } from "../lib/wavoipWebhookHandler.js";
import { logWavoipIntegration } from "../lib/wavoipIntegrationLog.js";
import { handleNvoipDtmfWebhook } from "../lib/nvoipDtmfWebhook.js";
import { handleNvoipCallWebhook } from "../lib/nvoipCallWebhook.js";

type WebhookRequest = FastifyRequest & { rawBody?: string };

/** Captura o corpo bruto para validar X-Hub-Signature-256 (Meta) com os bytes originais. */
async function captureWebhookRawBody(
  request: FastifyRequest,
  _reply: FastifyReply,
  payload: AsyncIterable<Buffer | string>,
): Promise<Readable> {
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  (request as WebhookRequest).rawBody = raw;
  return Readable.from([raw]);
}

const webhookPostOpts = { preParsing: captureWebhookRawBody };

/** Sufixos quando Evolution usa webhook_by_events: https://doc.evolution-api.com/v2/en/configuration/webhooks */
const WHATSAPP_POST_SUFFIXES = [
  "",
  "/messages-upsert",
  "/messages-update",
  "/messages-delete",
  "/messages-set",
  "/send-message",
  "/contacts-update",
  "/contacts-upsert",
  "/contacts-set",
  "/chats-update",
  "/chats-upsert",
  "/chats-set",
  "/chats-delete",
  "/connection-update",
  "/qrcode-updated",
  "/presence-update",
  "/groups-upsert",
  "/groups-update",
  "/group-participants-update",
  "/application-startup",
  "/new-jwt",
] as const;

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

type WhatsappWebhookTarget = {
  inboxId: string;
  whatsappProvider: string;
};

async function resolveWhatsappWebhookTarget(
  organizationId: string,
  options: { inboxId?: string; body?: unknown },
): Promise<WhatsappWebhookTarget | null> {
  let inboxId = options.inboxId;

  if (!inboxId && options.body) {
    const phoneId = extractMetaWebhookPhoneNumberId(options.body);
    if (phoneId) {
      const found = await findWhatsappInboxByPhoneNumberId(organizationId, phoneId);
      if (found) inboxId = found.id;
    }
  }

  if (!inboxId && options.body && isEvolutionGoWebhookPayload(options.body)) {
    inboxId = (await findEvolutionGoWhatsappInboxId(organizationId)) ?? undefined;
  }

  if (inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, organizationId },
      select: { id: true, channelConfig: true },
    });
    if (!inbox) return null;
    const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
    if (!creds) return null;
    return { inboxId: inbox.id, whatsappProvider: creds.whatsappProvider };
  }

  const defaultInboxId = await getDefaultInboxId(organizationId);
  const creds = await resolveInboxWhatsappCredentials(organizationId, {
    channelConfig: (
      await prisma.inbox.findFirst({
        where: { id: defaultInboxId, organizationId },
        select: { channelConfig: true },
      })
    )?.channelConfig,
  });
  if (!creds) return null;
  return { inboxId: defaultInboxId, whatsappProvider: creds.whatsappProvider };
}

async function handleWhatsAppPost(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
  options?: { inboxId?: string; skipWebhookSignature?: boolean },
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
    {
      url: request.url,
      contentLength: request.headers["content-length"],
      organizationId,
      inboxId: options?.inboxId,
    },
    "WhatsApp webhook POST received",
  );

  let body = normalizeJsonBody(request.body);
  if (body === null) {
    return reply.status(400).send({ error: "Invalid JSON body" });
  }

  let resolvedInboxId = options?.inboxId;
  if (isEvolutionGoWebhookPayload(body)) {
    const evoInbox = await findEvolutionGoWhatsappInboxId(organizationId);
    if (evoInbox) resolvedInboxId = evoInbox;
  }

  const target = await resolveWhatsappWebhookTarget(organizationId, {
    inboxId: resolvedInboxId,
    body,
  });
  if (!target) {
    app.log.warn({ organizationId }, "Webhook received but no WhatsApp inbox/provider resolved");
    return reply.status(200).send();
  }

  if (target.whatsappProvider === "evolution_go" || isEvolutionGoWebhookPayload(body)) {
    const inboxCreds = await resolveInboxWhatsappCredentials(organizationId, {
      channelConfig: (
        await prisma.inbox.findFirst({
          where: { id: target.inboxId, organizationId },
          select: { channelConfig: true },
        })
      )?.channelConfig,
    });
    const orgSettings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { whatsappPhoneNumberId: true, whatsappApiKey: true, whatsappProvider: true },
    });
    const matchSettings = {
      whatsappPhoneNumberId:
        inboxCreds?.whatsappPhoneNumberId ?? orgSettings?.whatsappPhoneNumberId ?? null,
      whatsappApiKey: inboxCreds?.whatsappApiKey ?? orgSettings?.whatsappApiKey ?? null,
    };
    if (
      (target.whatsappProvider === "evolution_go" || isEvolutionGoWebhookPayload(body)) &&
      !evolutionGoWebhookMatchesOrgInstance(body, matchSettings, organizationId)
    ) {
      app.log.info(
        {
          organizationId,
          inboxId: target.inboxId,
          payloadInstanceId: (body as Record<string, unknown>)?.instanceId,
          payloadInstance: (body as Record<string, unknown>)?.instance,
        },
        "Evolution Go webhook ignored: instance in payload does not match organization instance",
      );
      return reply.status(200).send();
    }
  }

  const provider = await getWhatsAppProviderForInbox(organizationId, target.inboxId);
  if (!provider) {
    app.log.warn(
      { organizationId, inboxId: target.inboxId },
      "Webhook received but provider could not be built for inbox",
    );
    return reply.status(200).send();
  }

  const secret = await getWebhookSecretForInbox(organizationId, target.inboxId);
  if (secret && !options?.skipWebhookSignature) {
    const rawBody =
      (request as WebhookRequest).rawBody ??
      (typeof request.body === "string" ? request.body : JSON.stringify(request.body));

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
    if (target.whatsappProvider === "evolution") {
      app.log.warn(
        {
          event: env.event,
          url: request.url,
          organizationId,
        },
        "Evolution webhook: nothing parsed — enable MESSAGES_UPSERT, MESSAGES_UPDATE and CONTACTS_* on the instance webhook; POST URL must be https://<seu-dominio>/webhooks/whatsapp/<uuid-da-organizacao> (Evolution may append /messages-upsert if webhook by events is enabled).",
      );
    } else if (target.whatsappProvider === "evolution_go") {
      app.log.warn(
        {
          event: env.event,
          url: request.url,
          organizationId,
        },
        "Evolution Go webhook: nothing parsed — use POST /instance/connect with webhookUrl https://<seu-dominio>/webhooks/whatsapp/<uuid-da-organizacao> and subscribe ALL; inbound events must be Message (not Evolution API v2 MESSAGES_UPSERT).",
      );
    }
  }

  for (const patch of contactSync ?? []) {
    try {
      const phone = normalizePhoneE164(patch.phone);
      if (!phone) continue;
      let existing = await findContactByInboundPhone(prisma, organizationId, phone, null);
      if (!existing) {
        const dn = patch.waDisplayName?.trim() || phone;
        existing = await prisma.contact.create({
          data: {
            organizationId,
            phone,
            name: dn,
            waId: phone,
            profilePictureUrl: patch.profilePictureUrl ?? undefined,
          },
        });
      }
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
      if (!existing.isGroupChat) {
        void syncContactProfilePicture({
          organizationId,
          contactId: existing.id,
          phone: existing.phone,
          profilePictureUrl: patch.profilePictureUrl ?? existing.profilePictureUrl,
          preferredInboxId: target.inboxId,
        }).catch(() => {});
      }
    } catch (err) {
      app.log.error(err, "Error applying contact sync from webhook");
    }
  }

  let channelSettings = await prisma.settings.findUnique({
    where: { organizationId },
  });
  if (!channelSettings) {
    channelSettings = await prisma.settings.create({
      data: { organizationId },
    });
  }
  const targetInboxAgentCtx = await getAgentBotDispatchContextForInbox(organizationId, target.inboxId);
  const useAgentBotOnInbox = Boolean(targetInboxAgentCtx);

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

      let contact = await findContactByInboundPhone(prisma, organizationId, phone, msg.from);
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
        const displayName = msg.isGroup
          ? defaultGroupName
          : (msg.pushName?.trim() || phone);
        contact = await prisma.contact.create({
          data: {
            organizationId,
            phone,
            name: displayName,
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

        if (!msg.isGroup) {
          void syncContactProfilePicture({
            organizationId,
            contactId: contact.id,
            phone: contact.phone,
            profilePictureUrl: contact.profilePictureUrl,
            preferredInboxId: target.inboxId,
          }).catch(() => {});
        }
      }

      if (!contactJustCreated && !contact.profilePictureUrl && !msg.isGroup) {
        void syncContactProfilePicture({
          organizationId,
          contactId: contact.id,
          phone: contact.phone,
          profilePictureUrl: contact.profilePictureUrl,
          preferredInboxId: target.inboxId,
        }).catch(() => {});
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

      let conversation = await ensureConversationForChannelInbox({
        organizationId,
        contactId: contact.id,
        inboxId: target.inboxId,
        lockSingleConversation: channelSettings.lockSingleConversation,
        activeConversationStatus: useAgentBotOnInbox ? "PENDING" : "OPEN",
        createDefaults: {
          status: useAgentBotOnInbox ? "PENDING" : "OPEN",
          assignedToId: null,
        },
      });

      let resolvedMediaUrl: string | null = msg.mediaUrl ?? null;
      let resolvedMediaType: string | null = msg.mediaType ?? null;
      if (
        target.whatsappProvider === "evolution" &&
        msg.evolutionWebMessage &&
        (msg.type === "IMAGE" ||
          msg.type === "VIDEO" ||
          msg.type === "DOCUMENT" ||
          msg.type === "AUDIO")
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
            { organizationId, waMessageId: msg.waMessageId, type: msg.type },
            "Evolution inbound media: getBase64FromMediaMessage failed — using original URL if any",
          );
        }
      }
      if (
        target.whatsappProvider === "evolution_go" &&
        msg.evolutionWebMessage &&
        typeof msg.evolutionWebMessage.base64 === "string" &&
        msg.evolutionWebMessage.base64.trim()
      ) {
        const mimetype =
          typeof msg.evolutionWebMessage.mimetype === "string" && msg.evolutionWebMessage.mimetype.trim()
            ? msg.evolutionWebMessage.mimetype.trim()
            : resolvedMediaType ?? "application/octet-stream";
        const fileName =
          typeof msg.evolutionWebMessage.fileName === "string" && msg.evolutionWebMessage.fileName.trim()
            ? msg.evolutionWebMessage.fileName.trim()
            : undefined;
        const local = await persistEvolutionGoInboundMediaAsLocalUrl({
          base64: msg.evolutionWebMessage.base64.trim(),
          mimetype,
          fileName,
        });
        if (local) {
          resolvedMediaUrl = local.mediaUrl;
          resolvedMediaType = local.mediaType;
        }
      }
      if (
        (target.whatsappProvider === "meta" || target.whatsappProvider === "360dialog") &&
        msg.metaMediaId &&
        (msg.type === "IMAGE" ||
          msg.type === "VIDEO" ||
          msg.type === "DOCUMENT" ||
          msg.type === "AUDIO")
      ) {
        const inboxCreds = await resolveInboxWhatsappCredentials(organizationId, {
          channelConfig: (
            await prisma.inbox.findFirst({
              where: { id: target.inboxId, organizationId },
              select: { channelConfig: true },
            })
          )?.channelConfig,
        });
        const accessToken = decrypt(inboxCreds?.whatsappApiKey) ?? "";
        if (accessToken) {
          const tryPersist = () =>
            persistMetaInboundMediaAsLocalUrl({
              accessToken,
              mediaId: msg.metaMediaId!,
              mimeTypeHint: msg.mediaType,
              fileName: msg.metaFileName,
            });
          let local = await tryPersist();
          if (!local) {
            await new Promise((r) => setTimeout(r, 800));
            local = await tryPersist();
          }
          if (local) {
            resolvedMediaUrl = local.mediaUrl;
            resolvedMediaType = local.mediaType;
          } else {
            app.log.warn(
              { organizationId, waMessageId: msg.waMessageId, type: msg.type },
              "Meta inbound media: Graph download failed",
            );
          }
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

      const inboundForPipeline = await maybeTranscribeInboundAudioMessage({
        message: inbound,
        enabled: channelSettings.audioTranscriptionEnabled,
        log: app.log,
      });
      const inboundBodyForRules = inboundForPipeline.body?.trim() ?? "";

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
          body: inboundForPipeline.body ?? inboundBody ?? null,
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

      if (inboundBodyForRules) {
        const rules = await prisma.autoTagRule.findMany({ where: { organizationId } });
        for (const rule of rules) {
          if (inboundBodyForRules.toLowerCase().includes(rule.keyword.toLowerCase())) {
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

      const conversationAgentCtx = await getAgentBotDispatchContextForInbox(
        organizationId,
        conversation.inboxId,
      );
      if (conversationAgentCtx) {
        const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id } });
        if (fresh) {
          void dispatchAgentBotWebhook({
            organizationId,
            settings: {
              agentBotId: conversationAgentCtx.agentBotId,
              agentBot: conversationAgentCtx.agentBot,
            },
            conversation: fresh,
            contact,
            message: inboundForPipeline,
            log: app.log,
          });
        }
      } else {
        app.log.warn(
          {
            organizationId,
            conversationId: conversation.id,
            inboxId: conversation.inboxId,
          },
          "Agent bot dispatch skipped: no active bot context found for inbox/settings",
        );
      }

      broadcastConversationUpdated(organizationId, conversation.id);
    } catch (err) {
      app.log.error(err, "Error processing incoming webhook message");
    }
  }

  for (const status of statusUpdates) {
    try {
      const targetMsg = await prisma.message.findFirst({
        where: {
          providerMsgId: status.waMessageId,
          conversation: { organizationId },
        },
        select: { conversationId: true },
      });
      await prisma.message.updateMany({
        where: {
          providerMsgId: status.waMessageId,
          conversation: { organizationId },
        },
        data: { status: status.status },
      });
      if (targetMsg) {
        broadcastConversationUpdated(organizationId, targetMsg.conversationId);
      }
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

  app.post("/meta/whatsapp", webhookPostOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    const cfg = await getWhatsAppEmbeddedConfig();
    if (!cfg) {
      return reply.status(503).send();
    }
    const body = normalizeJsonBody(request.body);
    if (body === null) {
      return reply.status(400).send({ error: "Invalid JSON body" });
    }
    const rawBody =
      (request as WebhookRequest).rawBody ??
      (typeof request.body === "string" ? request.body : JSON.stringify(request.body));
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
    const hit = await findOrganizationByMetaPhoneNumberId(phoneId);
    if (!hit) {
      app.log.warn({ phoneId }, "meta/whatsapp: no organization for phone_number_id");
      return reply.status(200).send();
    }
    return handleWhatsAppPost(app, request, reply, hit.organizationId, {
      inboxId: hit.inboxId,
      skipWebhookSignature: true,
    });
  });

  async function handleWhatsAppGet(
    organizationId: string,
    inboxId: string | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { isActive: true },
    });
    if (!org?.isActive) {
      return reply.status(503).send({ error: "Organization suspended" });
    }

    const target = await resolveWhatsappWebhookTarget(organizationId, { inboxId });
    if (!target) {
      return reply.status(503).send({ error: "Provider not configured" });
    }

    const provider = await getWhatsAppProviderForInbox(organizationId, target.inboxId);
    if (!provider) {
      return reply.status(503).send({ error: "Provider not configured" });
    }

    const challenge = provider.handleVerification(request.query as Record<string, string>);
    if (challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.status(403).send({ error: "Verification failed" });
  }

  app.get<{ Params: { organizationId: string; inboxId: string } }>(
    "/whatsapp/:organizationId/:inboxId",
    async (request, reply) => {
      return handleWhatsAppGet(request.params.organizationId, request.params.inboxId, request, reply);
    },
  );

  app.get<{ Params: { organizationId: string } }>("/whatsapp/:organizationId", async (request, reply) => {
    return handleWhatsAppGet(request.params.organizationId, undefined, request, reply);
  });

  for (const suffix of WHATSAPP_POST_SUFFIXES) {
    app.post<{ Params: { organizationId: string; inboxId: string } }>(
      `/whatsapp/:organizationId/:inboxId${suffix}`,
      webhookPostOpts,
      async (
        request: FastifyRequest<{ Params: { organizationId: string; inboxId: string } }>,
        reply: FastifyReply,
      ) => {
        return handleWhatsAppPost(app, request, reply, request.params.organizationId, {
          inboxId: request.params.inboxId,
        });
      },
    );
    app.post<{ Params: { organizationId: string } }>(
      `/whatsapp/:organizationId${suffix}`,
      webhookPostOpts,
      async (
        request: FastifyRequest<{ Params: { organizationId: string } }>,
        reply: FastifyReply,
      ) => {
        return handleWhatsAppPost(app, request, reply, request.params.organizationId);
      },
    );
  }

  app.post<{ Params: { organizationId: string; deviceId: string } }>(
    "/wavoip/:organizationId/:deviceId",
    webhookPostOpts,
    async (request, reply) => {
      const device = await prisma.wavoipDevice.findFirst({
        where: {
          id: request.params.deviceId,
          organizationId: request.params.organizationId,
        },
      });
      if (!device) {
        return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
      }

      // Webhook CRM (conversa, timeline, WS) corre sempre que o device existe; a flag só bloqueia UI/API de agente.
      const wavoipUiDisabled = !(await isOrganizationFeatureEnabled(
        request.params.organizationId,
        "wavoip_voice",
      ));
      if (wavoipUiDisabled) {
        await logWavoipIntegration({
          organizationId: request.params.organizationId,
          wavoipDeviceId: device.id,
          level: "info",
          eventType: "webhook_flag_ui_off",
          message:
            "Webhook processed with wavoip_voice off for UI; enable in Super Admin > Funcionalidades for agent voice shell.",
        });
      }

      const headerSecret =
        (request.headers["x-wavoip-webhook-secret"] as string | undefined) ??
        (request.headers["x-openconduit-token"] as string | undefined);

      if (!verifyWavoipWebhookSecret(device, headerSecret)) {
        return reply.status(401).send({ error: "Unauthorized", message: "Invalid webhook secret", statusCode: 401 });
      }

      const body = normalizeJsonBody(request.body);
      if (body === null) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid JSON body", statusCode: 400 });
      }

      try {
        const result = await handleWavoipWebhook(
          app,
          request.params.organizationId,
          request.params.deviceId,
          body,
        );
        if (!result.ok) {
          return reply.status(result.status).send({
            error: result.status === 404 ? "Not Found" : "Error",
            message: result.message,
            statusCode: result.status,
          });
        }
        return { ok: true };
      } catch {
        return reply.status(500).send({ error: "Internal Server Error", message: "Webhook failed", statusCode: 500 });
      }
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/nvoip/:organizationId",
    async (request, reply) => {
      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : {};

      const result = await handleNvoipCallWebhook({
        organizationId: request.params.organizationId,
        body,
      });

      if (!result.ok) {
        return reply.status(result.status).send({
          error: result.status === 404 ? "Not Found" : "Error",
          message: result.message,
          statusCode: result.status,
        });
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { organizationId: string; dispatchId: string } }>(
    "/nvoip/:organizationId/dtmf/:dispatchId",
    async (request, reply) => {
      const token =
        (typeof request.query === "object" &&
          request.query !== null &&
          "token" in request.query &&
          String((request.query as { token?: string }).token ?? "")) ||
        "";
      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : {};

      const result = await handleNvoipDtmfWebhook({
        organizationId: request.params.organizationId,
        dispatchId: request.params.dispatchId,
        token,
        body,
      });

      if (!result.ok) {
        return reply.status(result.status).send({
          error: result.status === 404 ? "Not Found" : "Error",
          message: result.message,
          statusCode: result.status,
        });
      }
      return { ok: true };
    },
  );
}
